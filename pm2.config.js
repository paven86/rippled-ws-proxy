module.exports = {
  apps: [{
    name: 'RIPPLEDWSPROXY',
    script: 'dist/index.js',
    watch: false,
    instances: 1, // NOTE: admin should report <all instance info>
    exec_mode: 'cluster',
    ignore_watch: ["node_modules", "db", ".git"],
    env: {
      DEBUG: 'app*'
    },
    env_pm2: {
      NODE_ENV: 'pm2',
      PORT: 4001
    }
  }]
}
