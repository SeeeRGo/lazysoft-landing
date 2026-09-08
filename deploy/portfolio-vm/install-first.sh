#!/usr/bin/env bash
# First install on a NEW dedicated Ubuntu VM only. Never run as an update.
set -euo pipefail
test "$(id -u)" = 0
test ! -e /srv/portfolio/data/portfolio.sqlite
test ! -e /srv/portfolio/current
bundle="${1:?Pass the absolute path to portfolio.tar.gz}"
config_dir="${2:?Pass the absolute path to deployment config directory}"
test -f "$bundle"
test -f "$config_dir/portfolio.service"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y ca-certificates curl xz-utils caddy
stage=$(mktemp -d /var/tmp/portfolio-install.XXXXXX)
chmod 700 "$stage"
curl --fail --silent --show-error --retry 3 https://nodejs.org/dist/v24.15.0/node-v24.15.0-linux-x64.tar.xz -o "$stage/node.tar.xz"
curl --fail --silent --show-error --retry 3 https://nodejs.org/dist/v24.15.0/SHASUMS256.txt -o "$stage/SHASUMS256.txt"
node_hash=$(awk '$2 == "node-v24.15.0-linux-x64.tar.xz" {print $1}' "$stage/SHASUMS256.txt")
test "${#node_hash}" = 64
test "$(sha256sum "$stage/node.tar.xz" | cut -d ' ' -f 1)" = "$node_hash"
install -d -m 755 /opt/portfolio-node
tar -xJf "$stage/node.tar.xz" -C /opt/portfolio-node --strip-components=1 --no-same-owner
id portfolio >/dev/null 2>&1 || useradd --system --home-dir /srv/portfolio --shell /usr/sbin/nologin portfolio
install -d -m 755 /srv/portfolio /srv/portfolio/releases /srv/portfolio/releases/initial
install -d -m 700 -o portfolio -g portfolio /srv/portfolio/data
tar -xzf "$bundle" -C "$stage" --no-same-owner
tar -xzf "$bundle" -C /srv/portfolio/releases/initial --exclude='portfolio/data' --no-same-owner
chmod 755 /srv/portfolio/releases/initial/portfolio
install -m 600 -o portfolio -g portfolio "$stage/portfolio/data/portfolio.sqlite" /srv/portfolio/data/portfolio.sqlite
ln -s /srv/portfolio/releases/initial/portfolio /srv/portfolio/current
install -m 644 "$config_dir/portfolio.service" /etc/systemd/system/portfolio.service
install -m 644 "$config_dir/portfolio-backup.service" /etc/systemd/system/portfolio-backup.service
install -m 644 "$config_dir/portfolio-backup.timer" /etc/systemd/system/portfolio-backup.timer
install -m 644 "$config_dir/backup-daily.mjs" /usr/local/lib/portfolio-backup.mjs
install -m 644 "$config_dir/Caddyfile" /etc/caddy/Caddyfile
/opt/portfolio-node/bin/node --test /srv/portfolio/current/test.mjs
caddy validate --config /etc/caddy/Caddyfile
systemctl daemon-reload
systemctl enable --now portfolio.service portfolio-backup.timer
systemctl restart caddy
systemctl start portfolio-backup.service
curl --fail --silent --show-error --retry 8 --retry-connrefused --retry-delay 1 http://127.0.0.1:8080/health
printf '\nInstalled. Private initial key: /srv/portfolio/data/initial-admin-key.txt\n'
