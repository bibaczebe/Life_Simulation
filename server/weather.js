'use strict';

const PROFILES = {
  clear:    { tempMod:  0, foodMod: 1.00, speedMod: 1.00, lightningChance: 0,     label: 'Bezchmurnie',  icon: '☀️'  },
  rain:     { tempMod: -3, foodMod: 0.85, speedMod: 0.90, lightningChance: 0,     label: 'Deszcz',       icon: '🌧️'  },
  storm:    { tempMod: -8, foodMod: 0.65, speedMod: 0.70, lightningChance: 0.003, label: 'Burza',        icon: '⛈️'  },
  blizzard: { tempMod:-18, foodMod: 0.45, speedMod: 0.50, lightningChance: 0,     label: 'Zamieć',       icon: '🌨️'  },
  drought:  { tempMod: +9, foodMod: 0.40, speedMod: 0.90, lightningChance: 0,     label: 'Susza',        icon: '🏜️'  },
  heatwave: { tempMod:+14, foodMod: 0.75, speedMod: 0.80, lightningChance: 0,     label: 'Upał',         icon: '🔥'  },
  fog:      { tempMod: -1, foodMod: 1.00, speedMod: 0.65, lightningChance: 0,     label: 'Mgła',         icon: '🌫️'  },
};

class WeatherSystem {
  constructor() {
    this.type = 'clear';
    this.daysLeft = 0;
    this.pending = null;
  }

  set(type, days = 3) {
    if (!PROFILES[type]) type = 'clear';
    this.pending = { type, days };
  }

  tick(newDay) {
    if (!newDay) return null;

    if (this.pending) {
      const prev = this.type;
      this.type = this.pending.type;
      this.daysLeft = this.pending.days;
      this.pending = null;
      return { changed: true, from: prev, to: this.type };
    }

    if (this.daysLeft > 0) {
      this.daysLeft--;
      if (this.daysLeft === 0) {
        const prev = this.type;
        this.type = 'clear';
        return { cleared: true, from: prev };
      }
    }
    return null;
  }

  get profile()  { return PROFILES[this.type] || PROFILES.clear; }
  get tempMod()  { return this.profile.tempMod;  }
  get foodMod()  { return this.profile.foodMod;  }
  get speedMod() { return this.profile.speedMod; }
  get label()    { return this.profile.label;    }
  get icon()     { return this.profile.icon;     }

  checkLightning() {
    return Math.random() < this.profile.lightningChance;
  }

  serialize() {
    return { type: this.type, label: this.label, icon: this.icon, daysLeft: this.daysLeft };
  }
}

module.exports = { WeatherSystem };
