async function createBucket() {
  console.log("Requesting new bucket from KVDB.io...");
  const res = await fetch('https://kvdb.io', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'email=umpforthetest@gmail.com'
  });
  console.log("Status:", res.status);
  console.log("Headers:");
  res.headers.forEach((val, key) => console.log(`  ${key}: ${val}`));
  console.log("Body:", await res.text());
}
createBucket();
