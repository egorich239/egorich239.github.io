#!/bin/bash

readonly REPO_URL="https://egori.ch/deb/"
readonly REPO_NAME="egori.ch"
readonly REPO_KEY_FILE="/etc/apt/keyrings/${REPO_NAME}.asc"
readonly REPO_SOURCES_FILE="/etc/apt/sources.list.d/${REPO_NAME}.sources"

echo "Installing ${REPO_NAME} repository..."
echo -n "  - Registering repository key ${REPO_URL}key.asc"

curl -fsSL "${REPO_URL}key.asc" --proto '=https' -o - | sudo tee "${REPO_KEY_FILE}" >/dev/null
echo " done"

echo "  - Registering repository sources into:"
echo "    ${REPO_SOURCES_FILE}"
cat <<EOF | sudo tee "${REPO_SOURCES_FILE}" > /dev/null
Types: deb
URIs: ${REPO_URL}
Suites: stable
Components: main
Architectures: amd64,arm64
Signed-By: /etc/apt/keyrings/${REPO_NAME}.asc
EOF

echo "    done"

echo "Updating package lists..."
sudo apt-get update