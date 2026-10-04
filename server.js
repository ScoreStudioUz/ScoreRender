const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');

const app = express();
const PORT = process.env.PORT || 5500;
const DATA_FILE = path.join(__dirname, 'data', 'poses.json');
const UPLOADS_DIR = path.join(__dirname, 'uploads');

// Ensure directories exist
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
if (!fs.existsSync(path.join(__dirname, 'data'))) fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOADS_DIR));

// Setup Multer for custom skin uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.png';
    cb(null, `skin_${Date.now()}_${Math.random().toString(36).substr(2, 6)}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only images allowed'));
  }
});

// Helper to read poses
function getStoredPoses() {
  if (!fs.existsSync(DATA_FILE)) return [];
  try {
    const content = fs.readFileSync(DATA_FILE, 'utf-8');
    return JSON.parse(content);
  } catch (e) {
    console.error('Error reading poses.json:', e);
    return [];
  }
}

// Helper to save poses
function saveStoredPoses(poses) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(poses, null, 2), 'utf-8');
}

// Scrape pose from mcrender.net
async function scrapeMcRenderPose(slugOrUrl) {
  let clean = slugOrUrl.trim();
  let slug = clean;
  if (clean.includes('/p/')) {
    slug = clean.split('/p/')[1].split('?')[0].split('#')[0].replace(/\/+$/, '');
  } else if (clean.startsWith('http')) {
    slug = clean.split('/').pop().split('?')[0].split('#')[0];
  }

  if (!slug) throw new Error('Invalid pose slug or URL');

  const targetUrl = `https://www.mcrender.net/p/${slug}`;
  console.log(`[Import] Fetching pose: ${targetUrl}`);

  const html = await new Promise((resolve, reject) => {
    const req = https.get(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      }
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        // follow redirect
        https.get(res.headers.location, (r2) => {
          let body = '';
          r2.on('data', chunk => body += chunk);
          r2.on('end', () => resolve(body));
        }).on('error', reject);
        return;
      }
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve(body));
    });
    req.on('error', reject);
    req.setTimeout(15000, () => {
      req.destroy();
      reject(new Error('Timeout fetching pose'));
    });
  });

  // Extract from self.__next_f
  const nextChunks = html.match(/self\.__next_f\.push\(\[1,"(.*?)"\]\)/g);
  if (nextChunks) {
    for (const chunkMatch of nextChunks) {
      const unescaped = chunkMatch
        .replace(/^self\.__next_f\.push\(\[1,"/, '')
        .replace(/"\]\)$/, '')
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, '\\')
        .replace(/\\n/g, '\n');

      if (unescaped.includes('"nodeTransformation"')) {
        const poseIdx = unescaped.indexOf('{"pose":');
        if (poseIdx !== -1) {
          let depth = 0;
          let end = -1;
          for (let i = poseIdx; i < unescaped.length; i++) {
            if (unescaped[i] === '{') depth++;
            else if (unescaped[i] === '}') {
              depth--;
              if (depth === 0) {
                end = i + 1;
                break;
              }
            }
          }
          if (end !== -1) {
            const rawObj = unescaped.slice(poseIdx, end);
            const parsed = JSON.parse(rawObj);
            if (parsed && parsed.pose) {
              return parsed.pose;
            }
          }
        }
      }
    }
  }

  throw new Error(`Could not find 3D pose transformations for "${slug}". Make sure it is a valid public pose.`);
}

// API Routes

// 1. Get all poses
app.get('/api/poses', (req, res) => {
  const poses = getStoredPoses();
  res.json({ success: true, count: poses.length, poses });
});

// 1.1 Get single pose by slug
app.get('/api/pose/:slug', async (req, res) => {
  const { slug } = req.params;
  const poses = getStoredPoses();
  let found = poses.find(p => p.slug === slug);
  if (found) {
    return res.json({ success: true, pose: found });
  }

  // If not found in local DB, attempt auto-import from mcrender.net!
  try {
    const pose = await scrapeMcRenderPose(slug);
    poses.unshift(pose);
    saveStoredPoses(poses);
    return res.json({ success: true, pose });
  } catch (e) {
    return res.status(404).json({ success: false, error: 'Pose not found' });
  }
});

// Dedicated pose page route (1-to-1 like mcrender.net/p/:slug)
app.get('/p/:slug', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'pose.html'));
});

// 2. Import a new pose by URL or slug
app.post('/api/import-pose', async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ success: false, error: 'URL is required' });

    const pose = await scrapeMcRenderPose(url);
    const existing = getStoredPoses();

    // Remove if already exists to update it
    const filtered = existing.filter(p => p.slug !== pose.slug && p.id !== pose.id);
    filtered.unshift(pose); // Add to top
    saveStoredPoses(filtered);

    console.log(`[Import] Successfully saved pose: "${pose.name}" (${pose.slug})`);
    res.json({ success: true, pose });
  } catch (err) {
    console.error('[Import Error]', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 3. Delete pose
app.delete('/api/poses/:slug', (req, res) => {
  const { slug } = req.params;
  let poses = getStoredPoses();
  const initialLen = poses.length;
  poses = poses.filter(p => p.slug !== slug);
  if (poses.length !== initialLen) {
    saveStoredPoses(poses);
    res.json({ success: true, message: `Pose ${slug} deleted` });
  } else {
    res.status(404).json({ success: false, error: 'Pose not found' });
  }
});

// 4. Resolve Minecraft nickname to skin
app.get('/api/skin/resolve', async (req, res) => {
  const username = (req.query.username || '').trim();
  if (!username) return res.status(400).json({ success: false, error: 'Username required' });

  try {
    // 1. Check Mojang API
    const profileRes = await new Promise((resolve, reject) => {
      https.get(`https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(username)}`, (r) => {
        let body = '';
        r.on('data', d => body += d);
        r.on('end', () => resolve({ status: r.statusCode, body }));
      }).on('error', reject);
    });

    if (profileRes.status === 200) {
      const profile = JSON.parse(profileRes.body);
      const uuid = profile.id;

      // Fetch session profile
      const sessionRes = await new Promise((resolve, reject) => {
        https.get(`https://sessionserver.mojang.com/session/minecraft/profile/${uuid}`, (r) => {
          let body = '';
          r.on('data', d => body += d);
          r.on('end', () => resolve({ status: r.statusCode, body }));
        }).on('error', reject);
      });

      if (sessionRes.status === 200) {
        const sessionData = JSON.parse(sessionRes.body);
        const textureProp = (sessionData.properties || []).find(p => p.name === 'textures');
        if (textureProp) {
          const decoded = JSON.parse(Buffer.from(textureProp.value, 'base64').toString('utf-8'));
          const skinObj = decoded.textures && decoded.textures.SKIN;
          if (skinObj && skinObj.url) {
            const model = (skinObj.metadata && skinObj.metadata.model === 'slim') ? 'slim' : 'classic';
            return res.json({
              success: true,
              username,
              uuid,
              model,
              skinUrl: skinObj.url,
              proxyUrl: `/api/skin/proxy?url=${encodeURIComponent(skinObj.url)}`
            });
          }
        }
      }
    }

    // Fallback: minotar
    const fallbackUrl = `https://minotar.net/skin/${encodeURIComponent(username)}`;
    return res.json({
      success: true,
      username,
      model: 'classic',
      skinUrl: fallbackUrl,
      proxyUrl: `/api/skin/proxy?url=${encodeURIComponent(fallbackUrl)}`
    });
  } catch (err) {
    console.error('Skin resolve error:', err.message);
    // fallback
    const fallbackUrl = `https://minotar.net/skin/${encodeURIComponent(username)}`;
    res.json({
      success: true,
      username,
      model: 'classic',
      skinUrl: fallbackUrl,
      proxyUrl: `/api/skin/proxy?url=${encodeURIComponent(fallbackUrl)}`
    });
  }
});

// 5. Proxy skin image with CORS headers
app.get('/api/skin/proxy', (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) return res.status(400).send('Missing url parameter');

  const client = targetUrl.startsWith('https') ? https : http;
  client.get(targetUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0'
    }
  }, (proxyRes) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', proxyRes.headers['content-type'] || 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    proxyRes.pipe(res);
  }).on('error', (err) => {
    console.error('Proxy error:', err.message);
    res.status(502).send('Error proxying skin image');
  });
});

// 6. Upload custom skin file
app.post('/api/upload-skin', upload.single('skin'), (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, error: 'No file uploaded' });
  const localUrl = `/uploads/${req.file.filename}`;
  res.json({
    success: true,
    skinUrl: localUrl,
    proxyUrl: localUrl,
    model: req.body.model || 'classic'
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`====================================================`);
  console.log(`🚀 MCRender Studio running at http://0.0.0.0:${PORT}`);
  console.log(`📡 Public: http://140.238.68.151:${PORT}`);
  console.log(`====================================================`);
});
