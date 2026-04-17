# NCLT Backend — GCP VM Deployment

Reference for redeployment, operations, and infra details.

---

## Infrastructure

| Item | Value |
|---|---|
| GCP Project | `valsco-jurident` |
| Region | `asia-south1` (Mumbai) |
| Zone | `asia-south1-a` |
| VM Name | `nclt-backend` |
| Machine Type | `e2-standard-4` (4 vCPU, 16 GB RAM) |
| Boot Disk | 30 GB `pd-balanced`, Debian 12 |
| Static External IP | `34.180.43.126` (reserved as `nclt-ip`) |
| Network Tag | `http-server` |
| Firewall Rule | `allow-nclt-http` — TCP 80, 443 from `0.0.0.0/0` |
| Labels | `env=production`, `app=nclt-backend` |

### Runtime

| Item | Value |
|---|---|
| Docker | installed via official `get.docker.com` repo on first boot (startup script) |
| Container Name | `nclt` |
| Image | `nclt-backend:latest` (built on the VM from `Dockerfile`) |
| Port Mapping | host `80` → container `8080` |
| Restart Policy | `--restart=always` |
| Timezone | `TZ=Asia/Kolkata` (drives the node-cron 00:00 and 08:00 IST jobs) |
| App Dir on VM | `/home/<user>/app` |
| Service Account | `/home/<user>/app/serviceAccount.json` (mode 600) |

### Env Vars Passed to Container

| Var | Source |
|---|---|
| `PORT` | `8080` |
| `TZ` | `Asia/Kolkata` |
| `FIREBASE_SERVICE_ACCOUNT` | Minified JSON from `serviceAccount.json` via `jq -c` |

---

## Health Check

```bash
curl http://34.180.43.126/ping
# => {"ok":true}
```

---

## Redeploy (after code changes)

Run from the repo root on your laptop. Requires `gcloud` logged in to `valsco-jurident`.

```bash
# 1. Package source (skips node_modules, .git, .env)
tar --exclude='node_modules' --exclude='.git' --exclude='.env' \
    -czf /tmp/nclt-src.tgz .

# 2. Upload
gcloud compute scp /tmp/nclt-src.tgz nclt-backend:~/nclt-src.tgz \
    --zone=asia-south1-a

# 3. Rebuild and restart on the VM
gcloud compute ssh nclt-backend --zone=asia-south1-a --quiet --command='
  set -e
  cd ~/app
  tar -xzf ~/nclt-src.tgz
  sudo docker build -t nclt-backend:latest .
  FSA=$(jq -c . serviceAccount.json)
  sudo docker rm -f nclt || true
  sudo docker run -d \
    --name nclt \
    --restart=always \
    -p 80:8080 \
    -e PORT=8080 \
    -e TZ=Asia/Kolkata \
    -e FIREBASE_SERVICE_ACCOUNT="$FSA" \
    nclt-backend:latest
  sudo docker ps --filter name=nclt
'
```

---

## Operations

### SSH to VM
```bash
gcloud compute ssh nclt-backend --zone=asia-south1-a
```

### Logs
```bash
# Tail
gcloud compute ssh nclt-backend --zone=asia-south1-a -- 'sudo docker logs -f nclt'

# Last 200 lines
gcloud compute ssh nclt-backend --zone=asia-south1-a -- 'sudo docker logs --tail 200 nclt'
```

### Restart / Stop / Start container
```bash
gcloud compute ssh nclt-backend --zone=asia-south1-a -- 'sudo docker restart nclt'
gcloud compute ssh nclt-backend --zone=asia-south1-a -- 'sudo docker stop nclt'
gcloud compute ssh nclt-backend --zone=asia-south1-a -- 'sudo docker start nclt'
```

### Stop / Start VM (stop = no compute billing, keeps disk + IP)
```bash
gcloud compute instances stop  nclt-backend --zone=asia-south1-a
gcloud compute instances start nclt-backend --zone=asia-south1-a
```

### Resize VM (e.g. bump to 8 vCPU)
```bash
gcloud compute instances stop nclt-backend --zone=asia-south1-a
gcloud compute instances set-machine-type nclt-backend \
    --zone=asia-south1-a --machine-type=e2-standard-8
gcloud compute instances start nclt-backend --zone=asia-south1-a
```

### Manually trigger the cron jobs (for testing)
```bash
gcloud compute ssh nclt-backend --zone=asia-south1-a -- '
  sudo docker exec nclt node -e "
    import(\"./src/cron/caseSyncCron.js\").then(m => m.caseSyncCronJob())
  "'
```

---

## Rotating the Firebase Service Account Key

1. Firebase Console → Project Settings → Service Accounts → **Generate new private key**
2. Save the downloaded JSON locally (keep it out of git).
3. Upload and restart:
   ```bash
   gcloud compute scp /path/to/new-sa.json nclt-backend:~/app/serviceAccount.json \
       --zone=asia-south1-a
   gcloud compute ssh nclt-backend --zone=asia-south1-a --command='
     cd ~/app
     chmod 600 serviceAccount.json
     FSA=$(jq -c . serviceAccount.json)
     sudo docker rm -f nclt
     sudo docker run -d --name nclt --restart=always -p 80:8080 \
       -e PORT=8080 -e TZ=Asia/Kolkata -e FIREBASE_SERVICE_ACCOUNT="$FSA" \
       nclt-backend:latest
   '
   ```
4. Delete the **old** key in the Google Cloud Console → IAM → Service Accounts → `firebase-adminsdk-fbsvc@valsco-jurident` → Keys.

---

## Recreate Infrastructure From Scratch

If the VM ever needs to be rebuilt:

```bash
# Static IP (only if not already reserved)
gcloud compute addresses create nclt-ip --region=asia-south1

# Firewall rule (only once)
gcloud compute firewall-rules create allow-nclt-http \
  --allow=tcp:80,tcp:443 \
  --target-tags=http-server \
  --source-ranges=0.0.0.0/0

# VM with Docker installed via startup script
# (startup script lives in /tmp/nclt-startup.sh — see below)
gcloud compute instances create nclt-backend \
  --zone=asia-south1-a \
  --machine-type=e2-standard-4 \
  --image-family=debian-12 --image-project=debian-cloud \
  --boot-disk-size=30GB --boot-disk-type=pd-balanced \
  --address=nclt-ip \
  --tags=http-server \
  --metadata-from-file=startup-script=/tmp/nclt-startup.sh \
  --labels=env=production,app=nclt-backend
```

### Startup script (`/tmp/nclt-startup.sh`)
```bash
#!/bin/bash
set -e
exec > /var/log/startup.log 2>&1
apt-get update
apt-get install -y ca-certificates curl jq
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian $(. /etc/os-release && echo "$VERSION_CODENAME") stable" > /etc/apt/sources.list.d/docker.list
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
systemctl enable --now docker
echo "STARTUP_DONE" > /var/log/startup.done
```

After the VM is reachable, follow the **Redeploy** section plus upload `serviceAccount.json` once:
```bash
gcloud compute scp /path/to/sa.json nclt-backend:~/app/serviceAccount.json \
    --zone=asia-south1-a
```

---

## Cost Snapshot (approx, sustained-use, asia-south1)

| Item | Monthly |
|---|---|
| `e2-standard-4` 24×7 | ~$97 |
| Static IP (in use) | ~$3 |
| 30 GB `pd-balanced` | ~$3 |
| Egress | usage-based |
| **Total** | **~$100–110** |

Stop the VM when idle to drop compute cost to $0 (you keep paying for disk + IP).

---

## Teardown

```bash
gcloud compute instances delete nclt-backend --zone=asia-south1-a --quiet
gcloud compute firewall-rules delete allow-nclt-http --quiet
gcloud compute addresses delete nclt-ip --region=asia-south1 --quiet
```

---

## Scheduled Jobs

Defined in `src/server.js`, running inside the container with `TZ=Asia/Kolkata`:

| Cron | Time (IST) | Function |
|---|---|---|
| `0 0 * * *` | 00:00 daily | `caseSyncCronJob` |
| `0 8 * * *` | 08:00 daily | `sendDueNotifications` |

Because `--restart=always` is set, the container comes back after any VM reboot and the schedules resume automatically.
