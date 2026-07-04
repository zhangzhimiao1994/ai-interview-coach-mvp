module.exports = {
  apps: [
    {
      name: "ai-interview-coach",
      script: "npm",
      args: "run start",
      env: {
        NODE_ENV: "production",
        HOSTNAME: "0.0.0.0",
        PORT: process.env.PORT || "3000",
        DATABASE_URL: process.env.DATABASE_URL || "file:./data/prod.db"
      }
    }
  ]
};
