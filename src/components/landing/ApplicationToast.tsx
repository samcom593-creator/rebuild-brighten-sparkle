import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { CheckCircle } from "lucide-react";

// Pool of realistic synthetic names
const firstNames = [
  "Marcus", "Destiny", "Jordan", "Taylor", "Avery", "Cameron", "Morgan", "Riley",
  "Jaylen", "Skylar", "Alexis", "Darius", "Jasmine", "Brandon", "Aaliyah", "Terrence",
  "Brianna", "Malik", "Kayla", "DeShawn", "Imani", "Tyrone", "Latoya", "Andre",
  "Keisha", "Jamal", "Tiffany", "DeMarcus", "Shaniqua", "Lamar", "Monique", "Kendrick",
  "Ebony", "Devin", "Shanice", "Jermaine", "Tamika", "Rashad", "Jasmine", "Darnell",
  "Aisha", "Terrell", "Kiara", "Marquis", "Dominique", "Xavier", "Cheyenne", "Isaiah",
];

const lastNames = [
  "Johnson", "Williams", "Brown", "Jones", "Davis", "Miller", "Wilson", "Moore",
  "Taylor", "Anderson", "Thomas", "Jackson", "White", "Harris", "Martin", "Thompson",
  "Garcia", "Martinez", "Robinson", "Clark", "Lewis", "Lee", "Walker", "Hall",
  "Allen", "Young", "King", "Wright", "Scott", "Green", "Baker", "Adams",
  "Nelson", "Hill", "Ramirez", "Campbell", "Mitchell", "Roberts", "Carter", "Phillips",
  "Evans", "Turner", "Torres", "Parker", "Collins", "Edwards", "Stewart", "Flores",
];

// Cities for variety
const cities = [
  "Atlanta", "Houston", "Dallas", "Chicago", "Miami", "Phoenix", "Los Angeles",
  "Detroit", "Charlotte", "Philadelphia", "Memphis", "Baltimore", "Nashville",
  "Jacksonville", "Indianapolis", "Columbus", "San Antonio", "Fort Worth",
];

function getRandomName(): { firstName: string; lastName: string; city: string } {
  const firstName = firstNames[Math.floor(Math.random() * firstNames.length)];
  const lastName = lastNames[Math.floor(Math.random() * lastNames.length)];
  const city = cities[Math.floor(Math.random() * cities.length)];
  return { firstName, lastName, city };
}

function getRandomTimeAgo(): string {
  const options = ["just now", "1 min ago", "2 mins ago", "3 mins ago", "moments ago"];
  return options[Math.floor(Math.random() * options.length)];
}

export function ApplicationToast() {
  const [visible, setVisible] = useState(false);
  const [notification, setNotification] = useState<{
    firstName: string;
    lastName: string;
    city: string;
    timeAgo: string;
  } | null>(null);

  useEffect(() => {
    // Show first notification after a short delay
    const initialDelay = setTimeout(() => {
      showNotification();
    }, 8000); // First one after 8 seconds

    // Then show periodically
    const interval = setInterval(() => {
      showNotification();
    }, 55000 + Math.random() * 15000); // Between 55-70 seconds

    return () => {
      clearTimeout(initialDelay);
      clearInterval(interval);
    };
  }, []);

  const showNotification = () => {
    const { firstName, lastName, city } = getRandomName();
    const timeAgo = getRandomTimeAgo();
    
    setNotification({ firstName, lastName, city, timeAgo });
    setVisible(true);

    // Auto-hide after 5 seconds
    setTimeout(() => {
      setVisible(false);
    }, 5000);
  };

  return (
    <AnimatePresence>
      {visible && notification && (
        <motion.div
          initial={{ opacity: 0, x: -100, y: 20 }}
          animate={{ opacity: 1, x: 0, y: 0 }}
          exit={{ opacity: 0, x: -100 }}
          transition={{ type: "spring", damping: 25, stiffness: 200 }}
          className="fixed bottom-6 left-6 z-50"
        >
          <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-background/95 backdrop-blur-lg border border-primary/20 shadow-2xl shadow-primary/10 max-w-xs">
            {/* Animated ring indicator */}
            <div className="relative flex-shrink-0">
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center">
                <CheckCircle className="h-5 w-5 text-primary-foreground" />
              </div>
              <span className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full bg-emerald-500 animate-pulse" />
            </div>
            
            {/* Content */}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground truncate">
                {notification.firstName} {notification.lastName}
              </p>
              <p className="text-xs text-muted-foreground">
                Applied from {notification.city} • {notification.timeAgo}
              </p>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
