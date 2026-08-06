import '@repo/config-env/load';
import { connectDB, disconnectDB, Lead } from '@repo/database';

/**
 * Removes Lead records that have neither contact.email nor contact.name —
 * the "Anonim lead" rows extract-lead.js used to create before it required
 * real contact info. Defaults to a dry run; pass --confirm to actually delete.
 */
async function main() {
    const confirm = process.argv.includes('--confirm');

    await connectDB();

    const filter = {
        $and: [
            { $or: [{ 'contact.email': { $exists: false } }, { 'contact.email': null }, { 'contact.email': '' }] },
            { $or: [{ 'contact.name': { $exists: false } }, { 'contact.name': null }, { 'contact.name': '' }] }
        ]
    };

    const count = await Lead.countDocuments(filter);

    if (!confirm) {
        console.log(`[dry run] ${count} anonymous lead(s) would be deleted. Re-run with --confirm to delete them.`);
    } else {
        const res = await Lead.deleteMany(filter);
        console.log(`Deleted ${res.deletedCount} anonymous lead(s).`);
    }

    await disconnectDB();
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
