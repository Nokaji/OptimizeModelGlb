import { NodeIO } from "@gltf-transform/core";

import {
  KHRDracoMeshCompression,
  KHRMeshQuantization,
  KHRTextureBasisu,
  KHRMaterialsEmissiveStrength,
  KHRMaterialsClearcoat,
  KHRMaterialsSpecular,
  KHRMaterialsIOR,
} from "@gltf-transform/extensions";

import {
  resample,
  textureCompress,
  dedup,
  prune,
  draco,
  weld,
  quantize,
  simplify,
  join,
} from "@gltf-transform/functions";

import draco3d from "draco3dgltf";
import sharp from "sharp";
import { MeshoptSimplifier } from "meshoptimizer";

import { readdir, mkdir, stat } from "node:fs/promises";
import path from "node:path";

const INPUT_DIR = "./input";
const OUTPUT_DIR = "./output";

const MAX_TEXTURE_SIZE = 1024;
const WEBP_QUALITY = 80;

const SIMPLIFY_RATIO = 0.75;
const ENABLE_SIMPLIFY = true;

await mkdir(OUTPUT_DIR, {
  recursive: true,
});

const io = new NodeIO()
  .registerExtensions([
    KHRDracoMeshCompression,
    KHRMeshQuantization,
    KHRTextureBasisu,
    KHRMaterialsEmissiveStrength,
    KHRMaterialsClearcoat,
    KHRMaterialsSpecular,
    KHRMaterialsIOR,
  ])
  .registerDependencies({
    "draco3d.decoder": await draco3d.createDecoderModule(),

    "draco3d.encoder": await draco3d.createEncoderModule(),

    "meshoptimizer.simplifier": MeshoptSimplifier,
  });

const files = await readdir(INPUT_DIR);

const glbFiles = files.filter((file) => file.toLowerCase().endsWith(".glb"));

console.log(`📂 ${glbFiles.length} modèle(s) trouvé(s).`);

console.log(`🚀 Optimisation agressive activée.`);

for (const file of glbFiles) {
  console.log("\n");
  console.log("═══════════════════════════════════════");
  console.log(`📦 ${file}`);
  console.log("═══════════════════════════════════════");

  const inputPath = path.join(INPUT_DIR, file);

  const outputPath = path.join(OUTPUT_DIR, file);

  try {
    const inputStats = await stat(inputPath);

    const inputSizeMB = inputStats.size / 1024 / 1024;

    console.log(`📏 Taille originale : ${inputSizeMB.toFixed(2)} MB`);

    console.log("📖 Lecture du GLB...");

    const document = await io.read(inputPath);

    const root = document.getRoot();

    console.log(`🔷 Meshes : ${root.listMeshes().length}`);

    console.log(
      `🔺 Primitives : ${
        root.listMeshes().flatMap((mesh) => mesh.listPrimitives()).length
      }`,
    );

    console.log(`🎨 Matériaux : ${root.listMaterials().length}`);

    console.log(`🖼️ Textures : ${root.listTextures().length}`);

    /*
     * Nettoyage
     */

    console.log("\n🧹 Suppression des ressources inutilisées...");

    await document.transform(prune());

    /*
     * Déduplication
     */

    console.log("♻️ Déduplication des ressources...");

    await document.transform(dedup());

    /*
     * Animations
     */

    console.log("🎞️ Optimisation des animations...");

    await document.transform(resample());

    console.log("🔗 Fusion des meshes compatibles...");

    await document.transform(
      join({
        keepNamed: true,
      }),
    );

    /*
     * Sommets
     */

    console.log("🔗 Fusion des sommets identiques...");

    await document.transform(weld());

    /*
     * Simplification
     */

    if (ENABLE_SIMPLIFY) {
      console.log(
        `📉 Simplification géométrique (${Math.round(
          SIMPLIFY_RATIO * 100,
        )} %)...`,
      );

      await document.transform(
        simplify({
          simplifier: MeshoptSimplifier,
          ratio: SIMPLIFY_RATIO,
        }),
      );
    }

    /*
     * Quantification
     */

    console.log("📦 Quantification de la géométrie...");

    await document.transform(quantize());

    /*
     * Textures
     */

    console.log("\n🖼️ Optimisation des textures...");

    for (const texture of root.listTextures()) {
      const image = texture.getImage();

      if (!image) {
        continue;
      }

      const name = texture.getName() || "Texture sans nom";

      const metadata = await sharp(image).metadata();

      const width = metadata.width ?? 0;

      const height = metadata.height ?? 0;

      console.log(`   🔍 ${name}: ${width}x${height}`);

      if (width > MAX_TEXTURE_SIZE || height > MAX_TEXTURE_SIZE) {
        const resized = await sharp(image)
          .resize({
            width: MAX_TEXTURE_SIZE,
            height: MAX_TEXTURE_SIZE,
            fit: "inside",
            withoutEnlargement: true,
          })
          .toBuffer();

        texture.setImage(resized);

        console.log(`   └─ 📐 Redimensionnée à ${MAX_TEXTURE_SIZE}px max`);
      }
    }

    /*
     * WebP
     */

    console.log("\n🗜️ Compression WebP...");

    await document.transform(
      textureCompress({
        encoder: sharp,
        targetFormat: "webp",
        quality: WEBP_QUALITY,
      }),
    );

    /*
     * Draco
     */

    console.log("\n🧊 Compression Draco...");

    await document.transform(draco());

    /*
     * Nettoyage final
     */

    console.log("♻️ Déduplication finale...");

    await document.transform(dedup(), prune());

    /*
     * Écriture
     */

    console.log("\n💾 Écriture du GLB...");

    await io.write(outputPath, document);

    /*
     * Statistiques
     */

    const outputStats = await stat(outputPath);

    const outputSizeMB = outputStats.size / 1024 / 1024;

    const reduction =
      ((inputStats.size - outputStats.size) / inputStats.size) * 100;

    console.log("\n");
    console.log("═══════════════════════════════════════");

    console.log("📊 RÉSULTAT");

    console.log("═══════════════════════════════════════");

    console.log(`📦 Avant       : ${inputSizeMB.toFixed(2)} MB`);

    console.log(`📦 Après       : ${outputSizeMB.toFixed(2)} MB`);

    console.log(`📉 Réduction   : ${reduction.toFixed(1)} %`);

    console.log(`🔷 Meshes      : ${root.listMeshes().length}`);

    console.log(`🎨 Matériaux   : ${root.listMaterials().length}`);

    console.log(`🖼️ Textures    : ${root.listTextures().length}`);

    console.log(`📁 Output      : ${outputPath}`);

    console.log("═══════════════════════════════════════");

    console.log(`✅ ${file} terminé.`);
  } catch (error: unknown) {
    console.error(`\n❌ Erreur sur ${file}`);

    if (error instanceof Error) {
      console.error(error.stack ?? error.message);
    } else {
      console.error(error);
    }
  }
}

console.log("\n✨ Optimisation terminée.");
