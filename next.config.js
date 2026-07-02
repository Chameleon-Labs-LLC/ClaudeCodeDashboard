/** @type {import('next').NextConfig} */
const os = require('os');

function getNetworkIPv4s() {
  const ifaces = os.networkInterfaces();
  const addrs = [];
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        addrs.push({ name, address: iface.address });
      }
    }
  }
  return addrs;
}

const networkIPs = getNetworkIPv4s();

if (process.env.NODE_ENV !== 'production' && !process.env.__CCD_DEV_BANNER_SHOWN) {
  process.env.__CCD_DEV_BANNER_SHOWN = '1';
  const port = process.env.PORT || '3000';
  console.log('\n  Reachable at:');
  console.log(`    - http://localhost:${port}`);
  for (const { name, address } of networkIPs) {
    console.log(`    - http://${address}:${port}  (${name})`);
  }
  console.log('');
}

const nextConfig = {
  allowedDevOrigins: networkIPs.map(({ address }) => address),
  // keep better-sqlite3 unbundled so its native-addon loading (including the
  // nativeBinding side-load in lib/db.ts) runs with real require semantics
  serverExternalPackages: ['better-sqlite3'],
  // This checkout is shared between Windows (PowerShell) and WSL. Turbopack
  // constant-folds process.platform into compiled chunks, so a build cache
  // written by one platform is poison for the other (e.g. lib/db.ts picking
  // the Linux .node binary on Windows). Separate build dirs per platform.
  // (This file runs unbundled in the Next CLI, so the check here is real.)
  distDir: `.next-${process.platform}`,
};

module.exports = nextConfig;
