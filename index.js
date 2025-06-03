require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const app = express();

app.use(cors({
  origin: ['https://uploadshp-rh.netlify.app', 'http://localhost:3000'],
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type'],
  credentials: true
}));
app.use(express.json());

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

app.use((req, res, next) => {
  const timestamp = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
  console.log(`[${timestamp}] ${req.method} ${req.url} - Body:`, req.body);
  next();
});

app.post('/validate-shapefile', async (req, res) => {
  const { zip_path, bucket } = req.body;
  console.log('Menerima request validasi:', { zip_path, bucket });

  if (!zip_path || !bucket) {
    console.error('Parameter hilang:', { zip_path, bucket });
    return res.status(400).json({ error: 'zip_path dan bucket wajib diisi!' });
  }

  const validBuckets = ['rhlvegetatif', 'rhlupsa', 'rhlfolu'];
  if (!validBuckets.includes(bucket)) {
    console.error('Bucket tidak valid:', bucket);
    return res.status(400).json({ error: `Bucket tidak valid! Harus salah satu dari: ${validBuckets.join(', ')}.` });
  }

  if (!zip_path.startsWith('shapefiles/') || !zip_path.toLowerCase().endsWith('.zip')) {
    console.error('Format zip_path tidak valid:', zip_path);
    return res.status(400).json({ error: 'zip_path harus dalam format shapefiles/<nama_file>.zip' });
  }

  try {
    const fileName = zip_path.split('/').pop();
    console.log('Mencari file:', { fileName, bucket, path: zip_path });

    const { data: shapefiles, error: shapefileError } = await supabase.storage
      .from(bucket)
      .list('shapefiles', { limit: 100, offset: 0 });

    if (shapefileError) {
      console.error('Error mengakses shapefiles:', shapefileError);
      return res.status(500).json({ error: 'Gagal mengakses bucket: ' + shapefileError.message });
    }

    console.log('Isi folder shapefiles:', shapefiles ? shapefiles.map(f => f.name) : 'Kosong');
    const fileExists = shapefiles.some(file => file.name === fileName);

    if (!fileExists) {
      const { data: rootData, error: rootError } = await supabase.storage
        .from(bucket)
        .list('', { limit: 100, offset: 0 });

      if (rootError) {
        console.error('Error mengakses root bucket:', rootError);
      }

      console.log('Isi root bucket:', rootData ? rootData.map(f => f.name) : 'Kosong');
      return res.status(404).json({
        error: `File ${fileName} tidak ditemukan di bucket ${bucket}/shapefiles`,
        rootContents: rootData ? rootData.map(f => f.name) : []
      });
    }

    res.status(200).json({
      message: 'Validasi berhasil',
      fileName,
      bucket,
      path: zip_path
    });
  } catch (error) {
    console.error('Error processing request:', error);
    res.status(500).json({
      error: 'Gagal memproses validasi',
      details: error.message
    });
  }
});

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK', timestamp: new Date().toISOString() });
});

const port = process.env.PORT || 3001;
app.listen(port, () => {
  console.log(`Server berjalan di port ${port}`);
});