import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import {
  byCategory,
  featuredFrom,
  findPlace,
  seedPlaces,
  uniqueSlug,
  type Category,
  type Place,
} from '@/lib/places';

const STORAGE_KEY = 'wain.places.v1';

type PlacesContextValue = {
  places: Place[];
  ready: boolean;
  getPlace: (slug: string) => Place | undefined;
  getFeatured: () => Place[];
  getByCategory: (category: Category) => Place[];
  /** Create a new place. Returns the stored place (with its final unique slug). */
  addPlace: (place: Place) => Promise<Place>;
  /** Update the place identified by `slug`. Returns the updated place. */
  updatePlace: (slug: string, place: Place) => Promise<Place>;
  removePlace: (slug: string) => Promise<void>;
  toggleFeatured: (slug: string) => Promise<void>;
  resetToSeed: () => Promise<void>;
};

const PlacesContext = createContext<PlacesContextValue | null>(null);

function isPlaceArray(value: unknown): value is Place[] {
  return (
    Array.isArray(value) &&
    value.every(
      (p) => p && typeof p === 'object' && typeof (p as Place).slug === 'string' && (p as Place).slug !== '',
    )
  );
}

export function PlacesProvider({ children }: { children: React.ReactNode }) {
  const [places, setPlaces] = useState<Place[]>(seedPlaces);
  const [ready, setReady] = useState(false);

  // Load persisted places once on mount, seeding storage on first launch.
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed: unknown = JSON.parse(raw);
          if (active && isPlaceArray(parsed)) {
            setPlaces(parsed);
          }
        } else {
          await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(seedPlaces));
        }
      } catch {
        // Fall back to the in-memory seed data if storage is unavailable.
      } finally {
        if (active) setReady(true);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  // Persist and update state together so callers never see a stale list.
  const commit = useCallback(async (next: Place[]) => {
    setPlaces(next);
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Ignore write failures — the in-memory state is still updated.
    }
  }, []);

  const addPlace = useCallback(
    async (place: Place) => {
      const slug = uniqueSlug(places, place.slug || place.name);
      const stored: Place = { ...place, slug };
      await commit([...places, stored]);
      return stored;
    },
    [places, commit],
  );

  const updatePlace = useCallback(
    async (slug: string, place: Place) => {
      const finalSlug = uniqueSlug(places, place.slug || place.name || slug, slug);
      const updated: Place = { ...place, slug: finalSlug };
      await commit(places.map((p) => (p.slug === slug ? updated : p)));
      return updated;
    },
    [places, commit],
  );

  const removePlace = useCallback(
    async (slug: string) => {
      await commit(places.filter((p) => p.slug !== slug));
    },
    [places, commit],
  );

  const toggleFeatured = useCallback(
    async (slug: string) => {
      await commit(places.map((p) => (p.slug === slug ? { ...p, featured: !p.featured } : p)));
    },
    [places, commit],
  );

  const resetToSeed = useCallback(async () => {
    await commit(seedPlaces);
  }, [commit]);

  const value = useMemo<PlacesContextValue>(
    () => ({
      places,
      ready,
      getPlace: (slug) => findPlace(places, slug),
      getFeatured: () => featuredFrom(places),
      getByCategory: (category) => byCategory(places, category),
      addPlace,
      updatePlace,
      removePlace,
      toggleFeatured,
      resetToSeed,
    }),
    [places, ready, addPlace, updatePlace, removePlace, toggleFeatured, resetToSeed],
  );

  return <PlacesContext.Provider value={value}>{children}</PlacesContext.Provider>;
}

export function usePlaces(): PlacesContextValue {
  const ctx = useContext(PlacesContext);
  if (!ctx) {
    throw new Error('usePlaces must be used within a PlacesProvider');
  }
  return ctx;
}
