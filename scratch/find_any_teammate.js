import { WEEKLY_CHALLENGE_DATA } from '../src/data/weekly_challenge.js';

const TEAMS = {
  // Orioles
  "Corbin Burnes": "Orioles",
  "Craig Kimbrel": "Orioles",
  "Gunnar Henderson": "Orioles",
  "Adley Rutschman": "Orioles",
  "Colton Cowser": "Orioles",
  "Anthony Santander": "Orioles",
  "Ryan Mountcastle": "Orioles",
  "Jordan Westburg": "Orioles",
  "Jackson Holliday": "Orioles",
  "Cedric Mullins": "Orioles",
  "Ramón Urías": "Orioles",

  // Tigers
  "Tarik Skubal": "Tigers",
  "Jason Foley": "Tigers",
  "Zach McKinstry": "Tigers",
  "Riley Greene": "Tigers",
  "Kerry Carpenter": "Tigers",
  "Mark Canha": "Tigers",
  "Colt Keith": "Tigers",
  "Gio Urshela": "Tigers",
  "Wenceel Pérez": "Tigers",
  "Jake Rogers": "Tigers",
  "Andy Ibáñez": "Tigers",

  // Dodgers
  "Yoshinobu Yamamoto": "Dodgers",
  "Evan Phillips": "Dodgers",
  "Shohei Ohtani": "Dodgers",
  "Mookie Betts": "Dodgers",
  "Freddie Freeman": "Dodgers",
  "Teoscar Hernández": "Dodgers",
  "Max Muncy": "Dodgers",
  "Will Smith": "Dodgers",
  "Gavin Lux": "Dodgers",
  "Andy Pages": "Dodgers",
  "Miguel Rojas": "Dodgers",

  // Giants
  "Logan Webb": "Giants",
  "Camilo Doval": "Giants",
  "Jung Hoo Lee": "Giants",
  "LaMonte Wade Jr.": "Giants",
  "Jorge Soler": "Giants",
  "Matt Chapman": "Giants",
  "Thairo Estrada": "Giants",
  "Wilmer Flores": "Giants",
  "Mike Yastrzemski": "Giants",
  "Patrick Bailey": "Giants",
  "Nick Ahmed": "Giants",

  // Yankees
  "Gerrit Cole": "Yankees",
  "Clay Holmes": "Yankees",
  "Anthony Volpe": "Yankees",
  "Juan Soto": "Yankees",
  "Aaron Judge": "Yankees",
  "Giancarlo Stanton": "Yankees",
  "Anthony Rizzo": "Yankees",
  "Gleyber Torres": "Yankees",
  "Alex Verdugo": "Yankees",
  "Jose Trevino": "Yankees",
  "Oswaldo Cabrera": "Yankees",

  // Red Sox
  "Nick Pivetta": "Red Sox",
  "Kenley Jansen": "Red Sox",
  "Jarren Duran": "Red Sox",
  "Rafael Devers": "Red Sox",
  "Tyler O'Neill": "Red Sox",
  "Triston Casas": "Red Sox",
  "Masataka Yoshida": "Red Sox",
  "Wilyer Abreu": "Red Sox",
  "Connor Wong": "Red Sox",
  "Ceddanne Rafaela": "Red Sox",
  "David Hamilton": "Red Sox",

  // Mets
  "Kodai Senga": "Mets",
  "Edwin Diaz": "Mets",
  "Brandon Nimmo": "Mets",
  "Francisco Lindor": "Mets",
  "Pete Alonso": "Mets",
  "J.D. Martinez": "Mets",
  "Jeff McNeil": "Mets",
  "Starling Marte": "Mets",
  "Harrison Bader": "Mets",
  "Francisco Alvarez": "Mets",
  "Brett Baty": "Mets",

  // Phillies
  "Zack Wheeler": "Phillies",
  "Jose Alvarado": "Phillies",
  "Kyle Schwarber": "Phillies",
  "Trea Turner": "Phillies",
  "Bryce Harper": "Phillies",
  "Alec Bohm": "Phillies",
  "Bryson Stott": "Phillies",
  "Nick Castellanos": "Phillies",
  "J.T. Realmuto": "Phillies",
  "Brandon Marsh": "Phillies",
  "Johan Rojas": "Phillies",

  // Astros
  "Framber Valdez": "Astros",
  "Josh Hader": "Astros",
  "Jose Altuve": "Astros",
  "Yordan Alvarez": "Astros",
  "Alex Bregman": "Astros",
  "Kyle Tucker": "Astros",
  "Jeremy Peña": "Astros",
  "Yainer Diaz": "Astros",
  "Jon Singleton": "Astros",
  "Jake Meyers": "Astros",
  "Mauricio Dubón": "Astros",

  // Rangers
  "Nathan Eovaldi": "Rangers",
  "Kirby Yates": "Rangers",
  "Marcus Semien": "Rangers",
  "Corey Seager": "Rangers",
  "Adolis García": "Rangers",
  "Josh Jung": "Rangers",
  "Nathaniel Lowe": "Rangers",
  "Jonah Heim": "Rangers",
  "Wyatt Langford": "Rangers",
  "Leody Taveras": "Rangers",
  "Ezequiel Duran": "Rangers"
};

let teammateMatchups = 0;
WEEKLY_CHALLENGE_DATA.forEach((game, gi) => {
  game.pitches.forEach((p, pi) => {
    const pTeam = TEAMS[p.pitcher];
    const bTeam = TEAMS[p.batter];
    if (pTeam && bTeam && pTeam === bTeam) {
      console.log(`Found teammate matchup in Game ${gi} (${game.title}): Pitcher ${p.pitcher} (${pTeam}) vs Batter ${p.batter} (${bTeam})`);
      teammateMatchups++;
    }
  });
});

console.log('Teammate matchups count:', teammateMatchups);
