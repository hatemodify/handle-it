#!/bin/bash
# ═══════════════════════════════════════
#  logger.sh — 로깅 유틸리티
# ═══════════════════════════════════════

# 색상
export _R='\033[0;31m' _G='\033[0;32m' _Y='\033[1;33m'
export _B='\033[0;34m' _M='\033[0;35m' _C='\033[0;36m'
export _W='\033[1;37m' _N='\033[0m'   _DIM='\033[2m'

AUTODEV_LOG_FILE="${AUTODEV_LOG_FILE:-/tmp/autodev.log}"

_ts() { date '+%H:%M:%S'; }

log_info()    { echo -e "${_B}[$(_ts)][INFO]${_N}  $*" | tee -a "$AUTODEV_LOG_FILE"; }
log_success() { echo -e "${_G}[$(_ts)][ OK ]${_N}  $*" | tee -a "$AUTODEV_LOG_FILE"; }
log_warn()    { echo -e "${_Y}[$(_ts)][WARN]${_N}  $*" | tee -a "$AUTODEV_LOG_FILE"; }
log_error()   { echo -e "${_R}[$(_ts)][ERR ]${_N}  $*" | tee -a "$AUTODEV_LOG_FILE"; }
log_step()    { echo -e "\n${_W}[$(_ts)]━━━ $* ━━━${_N}" | tee -a "$AUTODEV_LOG_FILE"; }
log_agent()   { echo -e "${_M}[$(_ts)][${1}]${_N} ${2}" | tee -a "$AUTODEV_LOG_FILE"; }
log_msg()     { echo -e "${_C}[$(_ts)][MSG]${_N}  ${_M}$1${_N} → ${_M}$2${_N}: $3" | tee -a "$AUTODEV_LOG_FILE"; }
