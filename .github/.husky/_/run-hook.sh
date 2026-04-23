#!/usr/bin/env sh

hook_name="$1"
shift

script_dir=${0%/*}
repo_root="$(git -C "${script_dir}/../.." rev-parse --show-toplevel 2>/dev/null)" || exit 1

deps_dir="${AXELATE_DEPS_DIR:-}"
if [ -z "${deps_dir}" ] && [ -d "${repo_root}/.deps" ]; then
    deps_dir="${repo_root}/.deps"
fi

if [ -z "${deps_dir}" ] && [ -n "${USERPROFILE:-}" ] && [ -d "${USERPROFILE}/Axelate-deps" ]; then
    deps_dir="${USERPROFILE}/Axelate-deps"
fi

if [ -z "${deps_dir}" ] && [ -n "${HOME:-}" ] && [ -d "${HOME}/Axelate-deps" ]; then
    deps_dir="${HOME}/Axelate-deps"
fi

if [ -n "${deps_dir}" ] && [ -x "${deps_dir}/node/node.exe" ]; then
    node_bin="${deps_dir}/node/node.exe"
elif command -v node >/dev/null 2>&1; then
    node_bin="$(command -v node)"
else
    exit 1
fi

exec "${node_bin}" "${repo_root}/.github/scripts/run-hook.mjs" "${hook_name}" "$@"
