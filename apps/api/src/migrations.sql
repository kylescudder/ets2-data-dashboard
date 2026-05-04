CREATE EXTENSION IF NOT EXISTS timescaledb;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS users (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        text NOT NULL UNIQUE,
  display_name text NOT NULL,
  api_key     text NOT NULL UNIQUE,
  avatar_url  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  truck_make  text,
  truck_model text,
  started_at  timestamptz NOT NULL DEFAULT now(),
  ended_at    timestamptz
);

CREATE INDEX IF NOT EXISTS sessions_user_started_idx ON sessions (user_id, started_at DESC);

CREATE TABLE IF NOT EXISTS telemetry (
  time              timestamptz NOT NULL,
  session_id        uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  user_id           uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  speed_kph         double precision NOT NULL,
  rpm               double precision NOT NULL,
  gear              integer NOT NULL,
  fuel_litres       double precision NOT NULL,
  fuel_capacity_l   double precision NOT NULL,
  odometer_km       double precision NOT NULL,
  truck_damage      double precision NOT NULL,
  cargo_damage      double precision NOT NULL,
  pos_x             double precision NOT NULL,
  pos_y             double precision NOT NULL,
  pos_z             double precision NOT NULL,
  heading           double precision NOT NULL,
  job_cargo         text,
  job_source        text,
  job_destination   text,
  job_remaining_km  double precision,
  job_income        double precision
);

SELECT create_hypertable('telemetry', 'time', if_not_exists => TRUE);
CREATE INDEX IF NOT EXISTS telemetry_user_time_idx ON telemetry (user_id, time DESC);
CREATE INDEX IF NOT EXISTS telemetry_session_time_idx ON telemetry (session_id, time DESC);
