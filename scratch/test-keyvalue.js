async function test() {
  console.log("Creating a key on keyvalue.xyz...");
  // POST to https://keyvalue.xyz/new to get a new token/key
  const createRes = await fetch('https://keyvalue.xyz/new', { method: 'POST' });
  console.log("Create Status:", createRes.status);
  const tokenUrl = await createRes.text();
  console.log("Token URL:", tokenUrl.trim());
  
  if (createRes.ok) {
    const keyUrl = tokenUrl.trim() + '/mytestkey';
    console.log("Writing value to key:", keyUrl);
    
    // POST to save value
    const postRes = await fetch(keyUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: 'my test value'
    });
    console.log("POST Status:", postRes.status);
    console.log("POST Response:", await postRes.text());
    
    // GET to retrieve value
    console.log("GETing value...");
    const getRes = await fetch(keyUrl);
    console.log("GET Status:", getRes.status);
    console.log("GET Response:", await getRes.text());
  }
}
test();
