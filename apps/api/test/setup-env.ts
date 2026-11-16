process.env.NODE_ENV = "test";
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgresql://privateride:privateride_dev@localhost:5432/privateride_test";
process.env.REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
process.env.JWT_ACCESS_SECRET = "test_access_secret_0123456789";
process.env.JWT_REFRESH_SECRET = "test_refresh_secret_0123456789";
process.env.JWT_ACCESS_TTL = "900";
process.env.JWT_REFRESH_TTL = "3600";
