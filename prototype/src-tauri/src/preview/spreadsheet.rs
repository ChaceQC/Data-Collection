use std::{fs::File, io::Read, path::Path};

use zip::ZipArchive;

const MAX_UNCOMPRESSED_CONTAINER_BYTES: u64 = 100 * 1024 * 1024;
const MAX_CONTAINER_ENTRIES: usize = 2_000;

pub(crate) fn has_supported_container(
    path: &Path,
    extension: &str,
) -> Result<bool, std::io::Error> {
    let mut file = File::open(path)?;
    let mut magic = [0_u8; 4];
    let length = file.read(&mut magic)?;
    if extension == "xls" {
        return Ok(length == 4 && magic == [0xd0, 0xcf, 0x11, 0xe0]);
    }
    if length != 4 || magic != [0x50, 0x4b, 0x03, 0x04] {
        return Ok(false);
    }
    let file = File::open(path)?;
    let mut archive = ZipArchive::new(file)
        .map_err(|_| std::io::Error::new(std::io::ErrorKind::InvalidData, "invalid office zip"))?;
    if archive.len() > MAX_CONTAINER_ENTRIES {
        return Ok(false);
    }
    let mut uncompressed_bytes = 0_u64;
    for index in 0..archive.len() {
        let entry = archive.by_index(index).map_err(|_| {
            std::io::Error::new(std::io::ErrorKind::InvalidData, "invalid office entry")
        })?;
        uncompressed_bytes = uncompressed_bytes.saturating_add(entry.size());
        if uncompressed_bytes > MAX_UNCOMPRESSED_CONTAINER_BYTES {
            return Ok(false);
        }
    }
    Ok(true)
}

#[cfg(test)]
mod tests {
    use std::{
        fs::{self, File},
        io::Write,
        time::{SystemTime, UNIX_EPOCH},
    };

    use zip::{write::SimpleFileOptions, CompressionMethod, ZipWriter};

    use super::has_supported_container;

    #[test]
    fn accepts_a_deflated_docx_container() {
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or_default();
        let path =
            std::env::temp_dir().join(format!("local-material-deflated-docx-{timestamp}.docx"));
        let file = File::create(&path).expect("DOCX fixture should be created");
        let mut archive = ZipWriter::new(file);
        let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
        archive
            .start_file("word/document.xml", options)
            .expect("DOCX entry should start");
        archive
            .write_all(b"<?xml version=\"1.0\"?><document />")
            .expect("DOCX entry should be written");
        archive.finish().expect("DOCX archive should finish");

        assert!(has_supported_container(&path, "docx").expect("DOCX should be inspected"));
        let _ = fs::remove_file(path);
    }
}
