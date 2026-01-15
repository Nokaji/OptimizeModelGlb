import { NodeIO } from '@gltf-transform/core';
import { KHRMeshQuantization, KHRTextureBasisu, KHRMaterialsEmissiveStrength, KHRDracoMeshCompression, KHRMaterialsClearcoat, KHRMaterialsSpecular, KHRMaterialsIOR } from '@gltf-transform/extensions';
import { resample, textureCompress, dedup, prune } from '@gltf-transform/functions';
import sharp from 'sharp';
import { readdir, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { rm } from 'node:fs';

const INPUT_DIR = './input';
const OUTPUT_DIR = './output';
const STEP_DIR = './step';

// Créer le dossier de sortie s'il n'existe pas
await mkdir(OUTPUT_DIR, { recursive: true });
await mkdir(STEP_DIR, { recursive: true });

const io = new NodeIO()
    .registerExtensions([KHRMeshQuantization, KHRTextureBasisu, KHRMaterialsEmissiveStrength, KHRDracoMeshCompression, KHRMaterialsClearcoat, KHRMaterialsSpecular, KHRMaterialsIOR]);

const files = await readdir(INPUT_DIR);
const glbFiles = files.filter(file => file.endsWith('.glb'));

console.log(`📂 ${glbFiles.length} modèles trouvés. Début de l'optimisation...`);

for (const file of glbFiles) {
    console.log(`\n📦 Traitement de : ${file}`);
    const inputPath = path.join(INPUT_DIR, file);
    const outputPath = path.join(OUTPUT_DIR, file);
    const stepPath = path.join(STEP_DIR, file);

    try {
        // 1. Lire le document GLB
        const document = await io.read(inputPath);

        // 2. Appliquer les transformations
        await document.transform(
            // Supprime les données invisibles/inutilisées
            prune(),
            // Fusionne les données identiques (textures, accès)
            dedup(),
            // Redimensionne les textures si elles sont trop grandes (ex: max 1024px)
            resample(),
            // Compresse toutes les textures en WebP via Sharp
            textureCompress({
                encoder: sharp,
                targetFormat: 'webp',
                resize: [1024, 1024]
            })
        );

        // 3. Écrire le fichier optimisé
        await io.write(stepPath, document);
        execSync(`gltf-pipeline -i "${stepPath}" -o "${outputPath}" -d`);

        rm(stepPath, () => {
            console.log(`🧹 Fichier temporaire supprimé : ${stepPath}`);
        });

        console.log(`✅ Terminé : ${file}`);

    } catch (error: unknown) {
        if (error instanceof Error) {
            console.error(`❌ Erreur sur ${file}:`, error.message);
        } else {
            console.error(`❌ Erreur non identifiée sur ${file}`);
        }
    }
}

console.log('\n✨ Tous les modèles ont été optimisés dans le dossier /output');