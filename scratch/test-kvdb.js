async function test() {
  const urls = [
    'https://kvdb.io/8xQ1K9aM2cR5yV7d/weekly',
    'https://kvdb.io/8xQ1K9aM2cR5yV7d/users',
  ];
  for (const url of urls) {
    console.log(`Fetching: ${url}`);
    const res = await fetch(url);
    console.log("GET Status:", res.status);
    console.log("Response:", await res.text());
  }
}
test();
