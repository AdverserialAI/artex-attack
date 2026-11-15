#!/bin/sh
set -eu

mkdir -p /app/data /home/artex
chown -R artex:artex /app/data /home/artex
if [ -d /app/skills ]; then
  chown -R artex:artex /app/skills
fi

export HOME=/home/artex
exec runuser -u artex -- /app/start.sh "$@"
