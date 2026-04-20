#!/usr/bin/env bash
# ─── Life Simulation — deploy.sh ─────────────────────────────────────────────
# Usage:
#   ./deploy.sh                     # docker-compose (local / Render)
#   ./deploy.sh render               # push image to Docker Hub, for Render pull
#   ./deploy.sh ec2 user@host        # build locally, deploy via SSH to EC2
#   ./deploy.sh ec2-remote user@host # pull from Docker Hub on EC2
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

IMAGE="${DOCKER_IMAGE:-life-simulation}"
TAG="${DOCKER_TAG:-latest}"
FULL_IMAGE="${DOCKERHUB_USER:-myuser}/${IMAGE}:${TAG}"

log()  { printf '\033[1;36m[DEPLOY]\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m[OK]\033[0m    %s\n' "$*"; }
err()  { printf '\033[1;31m[ERR]\033[0m   %s\n' "$*"; exit 1; }

require() { command -v "$1" &>/dev/null || err "$1 not found — install it first."; }

# ─── LOCAL / docker-compose ───────────────────────────────────────────────────
deploy_local() {
  require docker
  log "Building + starting via docker-compose..."
  docker compose down --remove-orphans 2>/dev/null || true
  docker compose build --no-cache
  docker compose up -d
  ok "Container running at http://localhost:3000"
  docker compose logs -f --tail=40
}

# ─── RENDER — push to Docker Hub ─────────────────────────────────────────────
deploy_render() {
  require docker
  [ -z "${DOCKERHUB_USER:-}" ] && err "Set DOCKERHUB_USER env var (your Docker Hub username)"
  [ -z "${DOCKERHUB_TOKEN:-}" ] && err "Set DOCKERHUB_TOKEN env var (Docker Hub access token)"

  log "Logging in to Docker Hub..."
  echo "${DOCKERHUB_TOKEN}" | docker login -u "${DOCKERHUB_USER}" --password-stdin

  log "Building image ${FULL_IMAGE}..."
  docker build --platform linux/amd64 -t "${FULL_IMAGE}" .

  log "Pushing ${FULL_IMAGE}..."
  docker push "${FULL_IMAGE}"

  ok "Image pushed. In Render → New Web Service → Docker → use image: ${FULL_IMAGE}"
  ok "Set env vars ANTHROPIC_API_KEY, OPENAI_API_KEY, TELEGRAM_BOT_TOKEN, etc. in Render dashboard."
}

# ─── EC2 — build locally, scp, run ──────────────────────────────────────────
deploy_ec2() {
  SSH_TARGET="${1:-}"
  [ -z "$SSH_TARGET" ] && err "Usage: ./deploy.sh ec2 user@host"
  require docker
  require ssh

  log "Building image for linux/amd64..."
  docker build --platform linux/amd64 -t "${IMAGE}:${TAG}" .

  TARBALL="/tmp/${IMAGE}-${TAG}.tar"
  log "Saving image to ${TARBALL}..."
  docker save "${IMAGE}:${TAG}" | gzip > "${TARBALL}.gz"

  log "Copying to ${SSH_TARGET}..."
  scp "${TARBALL}.gz" "${SSH_TARGET}:/tmp/"

  log "Loading + starting on remote..."
  ssh "${SSH_TARGET}" bash <<REMOTE
    set -e
    docker load < /tmp/${IMAGE}-${TAG}.tar.gz
    docker stop life-sim 2>/dev/null || true
    docker rm   life-sim 2>/dev/null || true
    docker run -d --name life-sim \
      --restart unless-stopped \
      -p 3000:3000 \
      --env-file /opt/life-sim/.env \
      ${IMAGE}:${TAG}
    echo "Container started"
    docker logs --tail 20 life-sim
REMOTE
  ok "Deployed to ${SSH_TARGET}:3000"
}

# ─── EC2 — pull from Docker Hub on remote ────────────────────────────────────
deploy_ec2_remote() {
  SSH_TARGET="${1:-}"
  [ -z "$SSH_TARGET" ] && err "Usage: ./deploy.sh ec2-remote user@host"
  [ -z "${DOCKERHUB_USER:-}" ] && err "Set DOCKERHUB_USER"

  log "Deploying ${FULL_IMAGE} on ${SSH_TARGET}..."
  ssh "${SSH_TARGET}" bash <<REMOTE
    set -e
    docker pull ${FULL_IMAGE}
    docker stop life-sim 2>/dev/null || true
    docker rm   life-sim 2>/dev/null || true
    docker run -d --name life-sim \
      --restart unless-stopped \
      -p 3000:3000 \
      --env-file /opt/life-sim/.env \
      ${FULL_IMAGE}
    docker logs --tail 20 life-sim
REMOTE
  ok "Done — visit http://${SSH_TARGET%%@*}:3000"
}

# ─── Router ──────────────────────────────────────────────────────────────────
MODE="${1:-local}"
case "$MODE" in
  local)      deploy_local ;;
  render)     deploy_render ;;
  ec2)        deploy_ec2        "${2:-}" ;;
  ec2-remote) deploy_ec2_remote "${2:-}" ;;
  *)          err "Unknown mode: $MODE. Use: local | render | ec2 user@host | ec2-remote user@host" ;;
esac
