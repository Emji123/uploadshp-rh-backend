require('dotenv').config(); // Load .env di awal

const express = require('express');
const { createClient } = require('webdav');
const JSZip = require('jszip');
const { openDbf } = require('shapefile');
const cors = require('cors');
const multer = require('multer');

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

app.use(cors());
app.use(express.json());

// Konfigurasi WebDAV dari .env
const webdavClient = createClient(
  process.env.WEBDAV_URL || 'https://ditrh.synology.me:5006/',
  {
    username: process.env.WEBDAV_USERNAME,
    password: process.env.WEBDAV_PASSWORD
  }
);

const requiredFieldsMap = {
  'RHL Vegetatif': [
    'ID_RHL', 'BPDAS', 'UR_BPDAS', 'PELAKSANA', 'PROV', 'KAB', 'KEC', 'DESA',
    'NAMA_BLOK', 'LUAS_HA', 'TIPE_KNTRK', 'PEMANGKU', 'FUNGSI', 'ARAHAN',
    'POLA', 'BTG_HA', 'THN_TNM', 'JENIS_TNM', 'BTG_TOTAL', 'TGL_KNTRK',
    'NO_KNTRK', 'NILAI_KNTR'
  ],
  'RHL UPSA': [
    'ID', 'BPDAS', 'UR_BPDAS', 'WADMPR', 'WADMKK', 'WADMKC', 'DESA',
    'KELOMPOK', 'THN_BUAT', 'LUAS_HA', 'JENIS_TNM', 'BTG_TOTAL', 'BTG_HA',
    'SPL_TEKNIS', 'FUNGSI_KWS', 'KET'
  ],
  'RHL FOLU': [
    'ID_RHL', 'BPDAS', 'UR_BPDAS', 'PELAKSANA', 'PROV', 'KAB', 'KEC', 'DESA',
    'NAMA_BLOK', 'LUAS_HA', 'TIPE_KNTRK', 'PEMANGKU', 'FUNGSI', 'ARAHAN',
    'POLA', 'BTG_HA', 'THN_TNM', 'JENIS_TNM', 'BTG_TOTAL', 'TGL_KNTRK',
    'NO_KNTRK', 'NILAI_KNTR'
  ]
};

// Fungsi buat folder bertingkat
async function ensureDirectory(path) {
  const parts = path.split('/');
  let currentPath = '';
  for (const part of parts) {
    if (!part) continue;
    currentPath += `/${part}`;
    try {
      const exists = await webdavClient.exists(currentPath);
      if (!exists) {
        console.log(`Membuat folder: ${currentPath}`);
        await webdavClient.createDirectory(currentPath);
      }
    } catch (err) {
      console.error(`Gagal membuat folder ${currentPath}:`, err.message);
      throw err;
    }
  }
}

// Fungsi validasi ZIP
async function validateZip(zipBuffer, activity) {
  try {
    const zip = new JSZip();
    const content = await zip.loadAsync(zipBuffer);
    const files = Object.keys(content.files);

    const shpFiles = files.filter(name => name.toLowerCase().endsWith('.shp'));
    if (shpFiles.length === 0) {
      return { valid: false, error: 'File ZIP harus berisi setidaknya satu file .shp.' };
    }

    const successMessages = [];
    const errorMessages = [];
    let shapefileIndex = 0;
    let validShapefileCount = 0;

    for (const shpFile of shpFiles) {
      shapefileIndex++;
      const baseName = shpFile.substring(0, shpFile.length - 4).toLowerCase();

      const shxFile = files.find(name => name.toLowerCase() === `${baseName}.shx`);
      const dbfFile = files.find(name => name.toLowerCase() === `${baseName}.dbf`);

      if (!shxFile || !dbfFile) {
        errorMessages.push(`${shapefileIndex}. Shapefile ${baseName} belum lengkap:\n    - Harus memiliki .shp, .shx, dan .dbf`);
        continue;
      }

      const dbfContent = await content.file(dbfFile).async('arraybuffer');
      const source = await openDbf(dbfContent);

      let missingFields = new Set();
      let emptyFieldsMap = new Map();
      let invalidLuasHA = [];
      let featureCount = 0;

      let result;
      do {
        result = await source.read();
        if (result.done) break;

        featureCount++;
        const feature = result.value;
        const properties = feature.properties || feature;

        for (const field of requiredFieldsMap[activity]) {
          if (!(field in properties)) {
            missingFields.add(field);
          } else {
            const value = properties[field];
            if (value === null || value === '') {
              if (!emptyFieldsMap.has(field)) {
                emptyFieldsMap.set(field, []);
              }
              emptyFieldsMap.get(field).push(featureCount);
            }
          }
        }

        if ('LUAS_HA' in properties) {
          const value = properties.LUAS_HA;
          if (value !== null && value !== '') {
            const numericValue = parseFloat(value);
            if (isNaN(numericValue)) {
              invalidLuasHA.push(`Baris ke-${featureCount}: LUAS_HA harus numerik`);
            } else {
              const decimalPart = numericValue % 1;
              if (decimalPart > 0.5) {
                invalidLuasHA.push(`Baris ke-${featureCount}: LUAS_HA desimal lebih dari 0.5`);
              }
            }
          }
        }
      } while (!result.done);

      if (featureCount === 0) {
        errorMessages.push(`${shapefileIndex}. Shapefile ${baseName} tidak memiliki data`);
        continue;
      }

      let shapefileErrors = [];
      if (missingFields.size > 0 || emptyFieldsMap.size > 0 || invalidLuasHA.length > 0) {
        shapefileErrors.push(`${shapefileIndex}. Shapefile ${baseName} belum lengkap:`);
        if (missingFields.size > 0) {
          shapefileErrors.push(`    a. Field yang belum ada:`);
          Array.from(missingFields).forEach(field => {
            shapefileErrors.push(`         - ${field}`);
          });
        }
        if (emptyFieldsMap.size > 0) {
          shapefileErrors.push(`    b. Field yang kosong:`);
          emptyFieldsMap.forEach((rows, field) => {
            shapefileErrors.push(`         - ${field}, pada baris: ${rows.join(', ')}`);
          });
        }
        if (invalidLuasHA.length > 0) {
          shapefileErrors.push(`    c. Kesalahan pada LUAS_HA:`);
          invalidLuasHA.forEach(error => {
            shapefileErrors.push(`         - ${error}`);
          });
        }
        errorMessages.push(shapefileErrors.join('\n'));
      } else {
        successMessages.push(`${shapefileIndex}. Shapefile ${baseName} sudah lengkap`);
        validShapefileCount++;
      }
    }

    if (validShapefileCount === shpFiles.length) {
      return { valid: true, success: 'Data sudah valid dan selesai diunggah' };
    } else {
      let combinedMessage = [];
      if (successMessages.length > 0) combinedMessage.push(successMessages.join('\n'));
      if (errorMessages.length > 0) combinedMessage.push(errorMessages.join('\n'));
      combinedMessage.push('Harap perbaiki shapefile dan upload ulang');
      return { valid: false, error: combinedMessage.join('\n') };
    }
  } catch (err) {
    return { valid: false, error: `Gagal memvalidasi ZIP: ${err.message}` };
  }
}

// Endpoint upload & validasi
app.post('/validate-shapefile', upload.single('file'), async (req, res) => {
  try {
    const { bpdas, year, activity } = req.body;
    const file = req.file;

    if (!file || !bpdas || !year || !activity) {
      return res.status(400).json({ error: 'Semua field harus diisi dan file harus diunggah' });
    }

    const validation = await validateZip(file.buffer, activity);
    if (!validation.valid) {
      return res.status(400).json({ error: validation.error });
    }

    const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }));
    const dateString = now.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }).replace(/ /g, '_').toUpperCase();
    const timeString = now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }).replace(/[:.]/g, '');
    const fileNameWithDate = `${dateString}_${timeString}_${file.originalname}`;

    const bucketMap = {
      'RHL Vegetatif': 'rhlvegetatif',
      'RHL UPSA': 'rhlupsa',
      'RHL FOLU': 'rhlfolu'
    };

    const folderPath = `shapefiles/${bucketMap[activity]}/${bpdas}/${year}`;
    await ensureDirectory(folderPath);

    const filePath = `${folderPath}/${fileNameWithDate}`;
    console.log(`Mengunggah file ke: ${filePath}`);
    await webdavClient.putFileContents(filePath, file.buffer, { overwrite: true });

    res.status(200).json({ message: 'Validasi berhasil dan file diunggah ke NAS Synology' });
  } catch (err) {
    res.status(500).json({ error: `Gagal memproses shapefile: ${err.message}` });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server berjalan di port ${PORT}`);
});
