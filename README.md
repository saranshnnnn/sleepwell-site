# SleepWell Mattress & Furniture website

A small Node website with a live catalogue and an admin page.

- `/` home page (featured products load from the catalogue)
- `/catalogue` browse, filter by category, search, product pop-ups
- `/admin` sign in to add, edit or delete products and upload photos

Prices are optional. When a product has no price, the site shows "Ask in store for pricing".

## Run it on your computer

```
npm install
ADMIN_PASSWORD=choose-a-long-password npm start
```

Open http://localhost:3000

## Deploy on Railway

1. Put this folder in a GitHub repository (or use the Railway CLI with `railway up`).
2. In Railway: **New Project > Deploy from GitHub repo** and pick it.
3. In the service **Variables**, add:
   - `ADMIN_PASSWORD` = a long password only you know (the admin page stays off without it)
   - `DATA_DIR` = `/data`
4. In the service, add a **Volume** and mount it at `/data`. This keeps your catalogue edits and uploaded photos when the site redeploys.
5. In **Settings > Networking**, click **Generate Domain**. That is your public web address.
6. Add the address to your Google Business Profile as the website.

Railway sets the port by itself. The health check is `/healthz`.

## Where the data lives

- Products: `DATA_DIR/products.json`. The first start copies `seed/products.json` there.
- Photos you upload in admin: `DATA_DIR/uploads/`
- Starter photos: `public/photos/`

Without a volume, changes made in admin are lost the next time the site redeploys.

## Notes

- Admin sign-in is one shared password with a 12-hour session, limited to 8 wrong tries per 15 minutes per address. Use a long password.
- Photos are resized in the browser before upload (largest side 1400 px).
- The catalogue names and photos were filled in from the photos you sent, with no prices. Edit or delete anything that does not match what you stock.
