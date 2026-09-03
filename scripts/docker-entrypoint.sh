#!/bin/sh
set -eu

writable_dirs="/app/server/data /app/server/uploads /app/server/logs"

if [ "$(id -u)" = "0" ]; then
  # Named volumes keep ownership from older root-running images. Repair only the
  # application-owned writable paths, then drop privileges for the real process.
  chown -R node:node $writable_dirs
  exec gosu node "$@"
fi

exec "$@"
