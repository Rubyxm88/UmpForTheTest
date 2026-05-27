async function initBins() {
  const base = 'https://jsonbin-zeta.vercel.app/api/bins';
  
  // 1. Create users bin (starts as empty object)
  const usersRes = await fetch(base, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  });
  const usersData = await usersRes.json();
  console.log("Users Bin ID:", usersData.id);

  // 2. Create weekly leaderboard bin (starts as empty array)
  const weeklyRes = await fetch(base, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify([])
  });
  const weeklyData = await weeklyRes.json();
  console.log("Weekly Leaderboard Bin ID:", weeklyData.id);

  // 3. Create daily leaderboard bin (starts as empty array)
  const dailyRes = await fetch(base, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify([])
  });
  const dailyData = await dailyRes.json();
  console.log("Daily Leaderboard Bin ID:", dailyData.id);

  // 4. Create all-time leaderboard bin (starts as empty array)
  const alltimeRes = await fetch(base, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify([])
  });
  const alltimeData = await alltimeRes.json();
  console.log("All-time Leaderboard Bin ID:", alltimeData.id);
}
initBins();
