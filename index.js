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

const validBpdas = [
  'krueng_aceh', 'wampu_sei_ular', 'asahan_barumun', 'agam_kuantan',
  'indragiri_rokan', 'batanghari', 'ketahun', 'musi', 'baturusa_cerucuk',
  'sei_jang_duriangkang', 'way_seputih_sekampung', 'citarum_ciliwung',
  'cimanuk_citanduy', 'pemali_jratun', 'solo', 'serayu_opak_progo',
  'brantas_sampean', 'kapuas', 'kahayan', 'barito', 'mahakam_berau',
  'tondano', 'bone_limboto', 'palu_poso', 'karama', 'jeneberang_saddang',
  'konaweha', 'unda_anyar', 'dodokan_moyosari', 'benain_noelmina',
  'waehapu_batu_merah', 'ake_malamo', 'remu_ransiki', 'memberamo'
];

const validYears = Array.from({ length: 2026 - 2019 + 1 }, (_, i) => (2019 + i).toString());

app.post('/validate-shapefile', async (req, res) => {
  const { zip_path, bucket } = req.body;
  console.log('Menerima request validasi:', { zip_path, bucket });

  // Validasi parameter dasar
  if (!zip_path || !bucket) {
    console.error('Parameter hilang:', { zip_path, bucket });
    return res.status(400).json({ error: 'zip_path dan bucket wajib diisi!' });
  }

  const validBuckets = ['rhlvegetatif', 'rhlupsa', 'rhlfolu'];
  if (!validBuckets.includes(bucket)) {
    console.error('Bucket tidak valid:', bucket);
    return res.status(400).json({ error: `Bucket tidak valid! Harus salah satu dari: ${validBuckets.join(', ')}.` });
  }

  // Validasi format zip_path: shapefiles/{bpdas}/{tahun}/{nama_file}.zip
  const pathRegex = /^shapefiles\/([a-z_]+)\/([0-9]{4})\/(.+\.zip)$/i;
  const match = zip_path.match(pathRegex);
  if (!match) {
    console.error('Format zip_path tidak valid:', zip_path);
    return res.status(400).json({
      error: 'zip_path harus dalam format shapefiles/{bpdas}/{tahun}/{nama_file}.zip'
    });
  }

  const [, bpdas, year, fileName] = match;

  // Validasi BPDAS
  if (!validBpdas.includes(bpdas)) {
    console.error('BPDAS tidak valid:', bpdas);
    return res.status(400).json({
      error: `BPDAS tidak valid! Harus salah satu dari: ${validBpdas.join(', ')}.`
    });
  }

  // Validasi Tahun
  if (!validYears.includes(year)) {
    console.error('Tahun tidak valid:', year);
    return res.status(400).json({
      error: 'Tahun harus antara 2019 dan 2026.'
    });
  }

  try {
    console.log('Mencari file:', { fileName, bucket, path: zip_path });

    // Mencari file di folder shapefiles/{bpdas}/{tahun}/
    const folderPath = `shapefiles/${bpdas}/${year}`;
    const { data: files, error: listError } = await supabase.storage
      .from(bucket)
      .list(folderPath, { limit: 100, offset: 0 });

    if (listError) {
      console.error(`Error mengakses folder ${folderPath} di bucket ${bucket}:`, listError);
      return res.status(500).json({
        error: `Gagal mengakses folder ${folderPath} di bucket ${bucket}: ${listError.message}`
      });
    }

    console.log(`Isi folder ${folderPath}:`, files ? files.map(f => f.name) : 'Kosong');
    const fileExists = files.some(file => file.name === fileName);

    if (!fileExists) {
      return res.status(404).json({
        error: `File ${fileName} tidak ditemukan di ${folderPath} pada bucket ${bucket}`,
        folderContents: files ? files.map(f => f.name) : []
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