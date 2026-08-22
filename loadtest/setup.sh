#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# EliteDev Load Test Setup
# Installs k6 and prepares the load testing environment.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
RESET='\033[0m'

echo ""
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo -e "${CYAN}  EliteDev Load Test Setup${RESET}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo ""

# ── Check if k6 is installed ──────────────────────────────────────────────────
if command -v k6 &>/dev/null; then
  echo -e "${GREEN}✓ k6 is installed:${RESET} $(k6 version)"
  echo ""
else
  echo -e "${YELLOW}k6 is not installed. Installing...${RESET}"
  echo ""

  OS="$(uname -s)"
  ARCH="$(uname -m)"

  case "$OS" in
    Linux)
      echo -e "${CYAN}Detected: Linux ($ARCH)${RESET}"
      if command -v apt-get &>/dev/null; then
        sudo gpg -k
        sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg \
          --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D68 2>/dev/null
        echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" \
          | sudo tee /etc/apt/sources.list.d/k6.list >/dev/null
        sudo apt-get update -qq
        sudo apt-get install -y k6
      elif command -v yum &>/dev/null; then
        sudo dnf install -y https://dl.k6.io/rpm/noarch/k6-1.0-1.fc37.noarch.rpm 2>/dev/null || \
        sudo yum install -y k6
      else
        echo -e "${YELLOW}Auto-install not supported for this Linux distro.${RESET}"
        echo "Install manually: https://grafana.com/docs/k6/latest/set-up/install-k6/"
        exit 1
      fi
      ;;
    Darwin)
      echo -e "${CYAN}Detected: macOS ($ARCH)${RESET}"
      if command -v brew &>/dev/null; then
        brew install k6
      else
        echo -e "${YELLOW}Homebrew not found.${RESET}"
        echo "Install Homebrew: https://brew.sh"
        echo "Or install k6 manually: https://grafana.com/docs/k6/latest/set-up/install-k6/"
        exit 1
      fi
      ;;
    MINGW*|MSYS*|CYGWIN*)
      echo -e "${CYAN}Detected: Windows${RESET}"
      if command -v choco &>/dev/null; then
        choco install k6
      elif command -v scoop &>/dev/null; then
        scoop install k6
      else
        echo -e "${YELLOW}Auto-install not supported on Windows.${RESET}"
        echo "Install via Chocolatey: choco install k6"
        echo "Or download from: https://grafana.com/docs/k6/latest/set-up/install-k6/"
        exit 1
      fi
      ;;
    *)
      echo -e "${RED}Unsupported OS: $OS${RESET}"
      echo "Install k6 manually: https://grafana.com/docs/k6/latest/set-up/install-k6/"
      exit 1
      ;;
  esac

  echo ""
  echo -e "${GREEN}✓ k6 installed:${RESET} $(k6 version)"
fi

# ── Create results directory ──────────────────────────────────────────────────
mkdir -p loadtest/results
echo -e "${GREEN}✓ Results directory created${RESET}"

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo -e "${CYAN}  Setup Complete${RESET}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo ""
echo -e "  Run load tests:"
echo -e "    ${GREEN}k6 run loadtest/dashboard.js${RESET}     # Dashboard only"
echo -e "    ${GREEN}k6 run loadtest/payroll.js${RESET}       # Payroll only"
echo -e "    ${GREEN}k6 run loadtest/accounting.js${RESET}    # Accounting only"
echo -e "    ${GREEN}k6 run loadtest/all.js${RESET}           # All scenarios"
echo ""
echo -e "  Or use the Node.js runner:"
echo -e "    ${GREEN}node loadtest/run.js${RESET}             # Quick profile"
echo ""
echo -e "  With staging target:"
echo -e "    ${GREEN}BASE_URL=https://staging.example.com k6 run loadtest/all.js${RESET}"
echo ""
