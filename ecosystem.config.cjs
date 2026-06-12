module.exports = {
  apps: [
    {
      name: 'team-todo',
      cwd: '/home/m3mfis/team-todo',
      script: 'node_modules/.bin/tsx',
      args: 'packages/server/src/index.ts',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '300M',
      env: {
        NODE_ENV: 'production',
        TZ: 'Europe/Moscow',
        PORT: '3002',
      },
    },
  ],
};
