async function test() {
  console.log("Testing JSONBin Zeta REST API...");
  try {
    // 1. Create a new bin
    console.log("Creating new bin...");
    const createRes = await fetch('https://jsonbin-zeta.vercel.app/api/bins', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hello: "world", count: 42 })
    });
    console.log("POST Status:", createRes.status);
    const postData = await createRes.json();
    console.log("POST Response:", postData);
    
    if (createRes.ok && postData.id) {
      const binId = postData.id;
      const binUrl = `https://jsonbin-zeta.vercel.app/api/bins/${binId}`;
      
      // 2. Retrieve the bin
      console.log(`GETing from ${binUrl}...`);
      const getRes = await fetch(binUrl);
      console.log("GET Status:", getRes.status);
      console.log("GET Response:", await getRes.json());
      
      // 3. Update the bin
      console.log(`PUTing update to ${binUrl}...`);
      const putRes = await fetch(binUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hello: "world", count: 100, updated: true })
      });
      console.log("PUT Status:", putRes.status);
      console.log("PUT Response:", await putRes.json());
      
      // 4. Retrieve again to confirm update
      console.log("GETing updated value...");
      const getRes2 = await fetch(binUrl);
      console.log("GET Status 2:", getRes2.status);
      console.log("GET Response 2:", await getRes2.json());
    }
  } catch (err) {
    console.log("Error:", err.message);
  }
}
test();
