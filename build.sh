#!/bin/bash

html_to_md() {
    local url="https://github.com/kreuzberg-dev/html-to-markdown/releases/download/v2.27.3/cli-x86_64-unknown-linux-gnu.tar.gz"
    local archive="/tmp/html-to-markdown.tar.gz"
    local extract_dir="/tmp/html-to-markdown-extracted"
    local install_dir="$HOME/.local/bin"
    local binary="$install_dir/html-to-markdown"

    # Ensure curl or wget is available (prefer wget, fallback to curl)
    if command -v wget &>/dev/null; then
        DOWNLOADER="wget"
        DOWNLOADER_ARGS="-q -O"
    elif command -v curl &>/dev/null; then
        DOWNLOADER="curl"
        DOWNLOADER_ARGS="-sSL -o"
    else
        echo "Error: Neither wget nor curl is installed." >&2
        return 1
    fi

    # Create temp and install directories
    mkdir -p "$HOME/tmp"
    mkdir -p "$install_dir"

    # Check if already installed and up-to-date (optional optimization)
    if [[ -f "$binary" ]] && "$binary" --version &>/dev/null; then
        local current_version=$("$binary" --version 2>&1 | grep -oP 'v\K[0-9]+\.[0-9]+\.[0-9]+' || echo "unknown")
        if [[ "$current_version" == "2.27.3" ]]; then
            echo "✅ html-to-markdown v2.27.3 already installed at $binary"
            return 0
        else
            echo "⚠️  Found older version ($current_version). Updating to v2.27.3..."
        fi
    fi

    echo "🔧 Installing html-to-markdown v2.27.3 (to $install_dir)..."

    # Download the archive
    if ! $DOWNLOADER $DOWNLOADER_ARGS "$archive" "$url"; then
        echo "Error: Failed to download from $url" >&2
        return 1
    fi

    # Verify archive was downloaded and is non-empty
    if [[ ! -s "$archive" ]]; then
        echo "❌ Downloaded file is empty or missing: $archive" >&2
        return 1
    fi

    # Clean previous extraction
    rm -rf "$extract_dir"
    mkdir -p "$extract_dir"

    # Extract
    if ! tar -xzf "$archive" -C "$extract_dir"; then
        echo "Error: Failed to extract archive." >&2
        rm -f "$archive"
        return 1
    fi

    # Source binary path
    local binary_src="$extract_dir/cli-x86_64-unknown-linux-gnu/html-to-markdown"
    if [[ ! -f "$binary_src" ]]; then
        echo "Error: Binary not found at $binary_src" >&2
        rm -rf "$extract_dir" "$archive"
        return 1
    fi

    # Install to ~/.local/bin
    cp "$binary_src" "$binary"
    chmod +x "$binary"

    # Cleanup
    rm -f "$archive"
    rm -rf "$extract_dir"

    echo "✅ Installed successfully: $binary"

    # Check if ~/.local/bin is in PATH
    if [[ ":$PATH:" != *":$install_dir:"* ]]; then
        echo ""
        echo "⚠️  Note: ~/.local/bin is not in your PATH."
        echo "   To use the command, either:"
        echo "     - Start a new shell, or"
        echo "     - Run:  export PATH=\"\$HOME/.local/bin:\$PATH\""
        echo "   To make it permanent, add that line to ~/.bashrc or ~/.zshrc."
    fi
}
html_to_md
