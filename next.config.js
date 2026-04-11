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
};

module.exports = nextConfig;
