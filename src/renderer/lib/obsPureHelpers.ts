import type { OBSSceneWithItems } from "@/lib/obsTypes";

export const getAllSceneItems = (scenes: OBSSceneWithItems[]): string[] => {
  const allItems: string[] = [];
  scenes.forEach((scene) => {
    const items = scene.items.map((item) => item.sourceName);
    allItems.push(...items);
  });
  const set = new Set(allItems);
  const uniqueNames = Array.from(set);
  uniqueNames.sort();
  return uniqueNames;
};

export const getAllScenes = (scenes: OBSSceneWithItems[]): string[] => {
  const sceneNames = scenes.map((s) => s.sceneName);
  sceneNames.sort();
  return sceneNames;
};
