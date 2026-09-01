'use strict';

const fs = require('fs');
const path = require('path');
const PELibrary = require('pe-library');
const { load } = require('resedit/cjs');

async function main() {
  const sourcePath = path.resolve(process.argv[2] || 'dist/ZELUX-DL.raw.exe');
  const destinationPath = path.resolve(process.argv[3] || 'dist/ZELUX-DL.exe');
  const projectRoot = path.resolve(__dirname, '..');
  const iconPath = path.join(projectRoot, 'assets', 'windows', 'ZELUX-DL.ico');
  const pkg = require(path.join(projectRoot, 'package.json'));

  if (!fs.existsSync(sourcePath)) throw new Error(`Missing source EXE: ${sourcePath}`);
  if (!fs.existsSync(iconPath)) throw new Error(`Missing Windows icon: ${iconPath}`);

  const ResEdit = await load();
  const executable = PELibrary.NtExecutable.from(fs.readFileSync(sourcePath));
  const resources = PELibrary.NtExecutableResource.from(executable);
  const iconFile = ResEdit.Data.IconFile.from(fs.readFileSync(iconPath));
  const iconGroups = ResEdit.Resource.IconGroupEntry.fromEntries(resources.entries);

  if (!iconGroups.length) throw new Error('The packaged EXE has no icon group to replace');
  for (const group of iconGroups) {
    ResEdit.Resource.IconGroupEntry.replaceIconsForResource(
      resources.entries,
      group.id,
      group.lang,
      iconFile.icons.map(item => item.data),
    );
  }

  const versionInfo = ResEdit.Resource.VersionInfo.fromEntries(resources.entries);
  if (!versionInfo.length) throw new Error('The packaged EXE has no version resource');
  for (const info of versionInfo) {
    const translations = info.getAvailableLanguages();
    const language = translations[0] || { lang: 1033, codepage: 1200 };
    info.setFileVersion(pkg.version, language.lang);
    info.setProductVersion(pkg.version, language.lang);
    info.setStringValues(language, {
      CompanyName: 'SMOKEx2',
      ProductName: 'ZELUX-DL',
      FileDescription: 'ZELUX-DL Multi-provider Download Manager',
      OriginalFilename: 'ZELUX-DL.exe',
      InternalName: 'ZELUX-DL',
      LegalCopyright: 'Copyright (c) 2026 SMOKEx2',
    });
    info.outputToResourceEntries(resources.entries);
  }

  resources.outputResource(executable);
  fs.writeFileSync(destinationPath, Buffer.from(executable.generate()));
  if (sourcePath !== destinationPath) fs.unlinkSync(sourcePath);
  console.log(`Applied ZELUX-DL icon and version ${pkg.version} to ${destinationPath}`);
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
