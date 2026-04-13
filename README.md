# MUK-BIOMEDSSA

**Mukuba University Biomedical Sciences Students Association**  
Official website + admin CMS — static HTML frontend with a Node.js/Express backend, Cloudinary image storage, and a JSON file for content state.

---

## Project Structure

```
muk-biomedssa/
├── public/
│   ├── index.html        ← Main public-facing website
│   └── admin.html        ← Password-protected CMS admin panel
├── storage/
│   └── cloudinary.js     ← Cloudinary upload/delete/list helpers
├── data/
│   └── state.json        ← Generated at runtime; holds all site content
├── index.js              ← Express server (API + static serving)
├── package.json
├── .env.example          ← Copy to .env and fill in your values
└── .gitignore
```

---

## Quick Start

### 1. Clone & install

```bash
git clone https://github.com/your-org/muk-biomedssa.git
cd muk-biomedssa
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env with your Cloudinary credentials and admin password
```

### 3. Create the data directory

```bash
npm run setup
```

### 4. Run

```bash
# Development (auto-restart on file changes)
npm run dev

# Production
npm start
```

Open **http://localhost:3000** for the public site and **/admin.html** for the CMS.

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `PORT` | No | Server port (default `3000`) |
| `NODE_ENV` | No | `development` or `production` |
| `ADMIN_USERNAME` | Yes | CMS login username |
| `ADMIN_PASSWORD` | Yes | CMS login password |
| `SESSION_SECRET` | Yes | Long random string for session signing |
| `CLOUDINARY_CLOUD_NAME` | Yes | From Cloudinary dashboard |
| `CLOUDINARY_API_KEY` | Yes | From Cloudinary dashboard |
| `CLOUDINARY_API_SECRET` | Yes | From Cloudinary dashboard |
| `CLOUDINARY_UPLOAD_PRESET` | No | For unsigned browser uploads |
| `CLOUDINARY_FOLDER` | No | Cloudinary folder name (default `muk-biomedssa`) |
| `STATE_FILE_PATH` | No | Path to state JSON (default `./data/state.json`) |

---

## API Endpoints

### Auth
| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/api/auth/login` | — | Login `{ username, password }` |
| `POST` | `/api/auth/logout` | — | Logout |
| `GET` | `/api/auth/status` | — | `{ isAdmin: bool }` |

### State (site content)
| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/state` | Public | Get full site state |
| `PUT` | `/api/state` | Admin | Replace full state |
| `PATCH` | `/api/state` | Admin | Merge-update partial state |

### Images (Cloudinary)
| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/api/upload` | Admin | Upload image `multipart/form-data` field `image` + `context` |
| `DELETE` | `/api/upload/:publicId` | Admin | Delete image from Cloudinary |
| `GET` | `/api/images` | Admin | List all images in Cloudinary folder |

### Contact
| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/api/contact` | Public | Submit contact form `{ name, email, message }` |
| `GET` | `/api/contact` | Admin | List all submissions |

### Health
| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/health` | Public | Server health check |

---

## Image Context Keys

When uploading images, pass a `context` field that identifies where the image belongs. These match the keys used in `state.json` and the frontend:

| Context | Where it appears |
|---|---|
| `logo` | Site logo in navbar |
| `hero.bg` | Hero section background |
| `exec.{i}` | Executive portrait (index i) |
| `highlight.{i}` | Highlight event photo (index i) |
| `product.{i}` | Product main photo (index i) |
| `product.{i}.pm.{mi}` | Product payment method logo |
| `mem.provider.{i}` | Membership provider logo (index i) |

---

## Deployment

### Render / Railway / Fly.io

1. Push to GitHub
2. Connect your repo in the platform dashboard
3. Set all environment variables from `.env.example`
4. Set start command to `npm start`
5. For persistent state, mount a volume at `/data` and set `STATE_FILE_PATH=/data/state.json`

### Cloudinary Setup

1. Create a free account at [cloudinary.com](https://cloudinary.com)
2. From your dashboard copy **Cloud Name**, **API Key**, **API Secret**
3. Go to **Settings → Upload → Add upload preset** — name it `muk_biomedssa_uploads`
4. Add all three values to your `.env`

---

## License

MIT © MUK-BIOMEDSSA
