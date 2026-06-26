#StreetView App
## Run locally on the Docker PC

Build the image:

```powershell
docker build -t streetview-app .
```

Remove the old container if it exists:

```powershell
docker rm -f streetview-app
```

Run the container using only port 5055:

```powershell
docker run --name streetview-app -p 5055:5055 -v "${PWD}/public/uploads:/app/public/uploads" -v "${PWD}/public/data:/app/public/data" streetview-app
```

Open:

```text
http://localhost:5055
```

---

## Open from another PC

Use the Docker PC/server IP:

```text
http://SERVER_IP:5055
```

