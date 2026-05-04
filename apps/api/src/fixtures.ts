export interface FixtureUser {
  name: string;
  displayName: string;
  apiKey: string;
  avatarUrl: string;
  truck: { make: string; model: string };
}

export const FIXTURE_USERS: FixtureUser[] = [
  {
    name: "mike",
    displayName: "Mike",
    apiKey: "demo-key-mike",
    avatarUrl: "https://api.dicebear.com/9.x/adventurer/svg?seed=mike",
    truck: { make: "Scania", model: "S 730" },
  },
  {
    name: "sarah",
    displayName: "Sarah",
    apiKey: "demo-key-sarah",
    avatarUrl: "https://api.dicebear.com/9.x/adventurer/svg?seed=sarah",
    truck: { make: "Volvo", model: "FH16" },
  },
  {
    name: "tom",
    displayName: "Tom",
    apiKey: "demo-key-tom",
    avatarUrl: "https://api.dicebear.com/9.x/adventurer/svg?seed=tom",
    truck: { make: "MAN", model: "TGX" },
  },
  {
    name: "lena",
    displayName: "Lena",
    apiKey: "demo-key-lena",
    avatarUrl: "https://api.dicebear.com/9.x/adventurer/svg?seed=lena",
    truck: { make: "Mercedes", model: "Actros" },
  },
  {
    name: "jonas",
    displayName: "Jonas",
    apiKey: "demo-key-jonas",
    avatarUrl: "https://api.dicebear.com/9.x/adventurer/svg?seed=jonas",
    truck: { make: "DAF", model: "XG+" },
  },
];

export const CITIES: Array<{ name: string; x: number; z: number }> = [
  { name: "Berlin",      x:  1300, z:  -200 },
  { name: "Hamburg",     x:   900, z:  -700 },
  { name: "Munich",      x:  1100, z:   900 },
  { name: "Paris",       x:  -800, z:   400 },
  { name: "Amsterdam",   x:   500, z:  -400 },
  { name: "Vienna",      x:  1900, z:   600 },
  { name: "Prague",      x:  1700, z:   100 },
  { name: "Warsaw",      x:  2400, z:  -200 },
  { name: "Stockholm",   x:  1500, z: -2000 },
  { name: "Madrid",      x: -1500, z:  1700 },
];

export const CARGOS = [
  "Pallets", "Cement", "Lumber", "Steel pipes", "Refrigerated food",
  "Glass panels", "Tractors", "Beer kegs", "Furniture", "Wind turbine blade",
];
