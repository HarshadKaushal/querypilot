#!/bin/sh
set -e
CERT_DIR=/var/lib/postgresql/certs
mkdir -p "$CERT_DIR"
if [ ! -f "$CERT_DIR/server.crt" ]; then
  openssl req -new -x509 -days 3650 -nodes \
    -subj "/CN=sample-db" \
    -keyout "$CERT_DIR/server.key" \
    -out "$CERT_DIR/server.crt"
  chown postgres:postgres "$CERT_DIR/server.key" "$CERT_DIR/server.crt"
  chmod 600 "$CERT_DIR/server.key"
fi
exec docker-entrypoint.sh "$@" -c ssl=on -c ssl_cert_file="$CERT_DIR/server.crt" -c ssl_key_file="$CERT_DIR/server.key"
