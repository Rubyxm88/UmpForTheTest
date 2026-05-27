async function test() {
  const bucketId = 'Ama2QmjczMhLEmZrrQA6qg'; // Use the newly created bucket ID
  const url = `https://kvdb.io/${bucketId}/testkey`;
  
  // Test PUT
  console.log("PUTing value...");
  const putRes = await fetch(url, {
    method: 'PUT',
    body: 'hello world value'
  });
  console.log("PUT Status:", putRes.status);
  console.log("PUT Response:", await putRes.text());

  // Test GET
  console.log("GETing value...");
  const getRes = await fetch(url);
  console.log("GET Status:", getRes.status);
  console.log("GET Response:", await getRes.text());
}
test();
