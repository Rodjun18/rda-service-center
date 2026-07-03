#!/bin/bash
echo ""
echo "========================================================="
echo " RDA MOBILE PHONE SERVICE CENTER - SERVER STARTING..."
echo "========================================================="
echo ""

# Check Node.js
if ! command -v node &> /dev/null; then
    echo " ERROR: Node.js is not installed!"
    echo " Please install from: https://nodejs.org"
    exit 1
fi

# No npm install needed — zero external dependencies!

# Start server
echo " Starting server..."
node server.js
