# Asset Vault

This project was built with assistance from GPT-6

Asset Vault is a Windows desktop library for organizing assets from multiple Unity projects. It uses Electron, React, Three.js, and a local JSON catalog stored in Electron's application-data folder.

## Features

- Add individual Unity project folders or scan a parent folder for Unity projects.
- Clone public GitHub repositories with Git; repositories are cloned into a folder you choose.
- Browse and search models, images, audio, and source files across projects.
- Preview FBX, OBJ, glTF, and GLB models in an interactive 3D viewer. Embedded FBX/glTF animations can be played; OBJ is static.
- Preview `.blend` files by exporting them to a cached glTF preview with Blender.
- Zoom into images and select frames from sprite sheets; play audio; inspect syntax-highlighted scripts.
- Add tags, favorites, and named collections. The catalog and organization metadata remain local to this computer.

## Requirements

- Windows 10 or later.
- Node.js 20+ and npm for development.
- Git installed and available on `PATH` to clone public repositories.
- Blender installed for `.blend` previews. In Asset Vault, use the Blender setting in the lower-left sidebar to select `blender.exe`.

## Run locally

```powershell
npm install
npm run dev
```

For a renderer production build, run `npm run build`. The development script launches Vite and Electron together.

## Notes

- Unity projects are indexed locally; this app does not upload project files.
- The scanner indexes supported files under each project's `Assets` folder and skips common generated folders such as `Library`, `Temp`, and `Build`.
- GitHub support is for public repositories over HTTPS. Cloning is performed by the system Git executable.
- Blender previews are generated on first view and cached in the app's local data folder. Changes to a `.blend` file produce a new preview cache entry.
- Supported image previews: PNG, JPEG, WebP, GIF, BMP, and TIFF. Supported audio previews: WAV, MP3, OGG, M4A, FLAC, and AIFF.
