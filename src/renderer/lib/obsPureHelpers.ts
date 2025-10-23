import type { Scene } from "obs-websocket-js";

export const getAllSceneItems = (scenes: Scene[]): string[] => {
  const allItems: string[] = [];
  scenes.forEach((scene) => {
    const items = scene.sources.map((source) => source.name);
    allItems.push(...items);
  });
  const set = new Set(allItems);
  const uniqueNames = Array.from(set);
  uniqueNames.sort();
  return uniqueNames;
};

export const getAllScenes = (scenes: Scene[]): string[] => {
  const sceneNames = scenes.map((s) => s.name);
  sceneNames.sort();
  return sceneNames;
};
