import { randomUUID } from 'node:crypto';
import { createTestDatabase } from './database-fixture';

describe('Legacy data migration preservation', () => {
  it('preserves ownership links, manual clothing, categories, audit actions and completed support records', async () => {
    const user = randomUUID(),
      category = randomUUID(),
      outfitCategory = randomUUID(),
      outfit = randomUUID();
    const reportCategory = randomUUID(),
      contactCategory = randomUUID(),
      report = randomUUID(),
      contact = randomUUID();
    const history = randomUUID(),
      bookmark = randomUUID(),
      star = randomUUID();
    const db = await createTestDatabase(async (client, migration) => {
      if (migration !== '20260914090000_complete_catalog_schema') return;
      await client.query(
        'INSERT INTO users(id,username,password,email,updated_at) VALUES($1,$4,$2,$3,now())',
        [user, 'unused', 'legacy@example.test', user],
      );
      await client.query(
        'INSERT INTO categories(id,category_name) VALUES($1,$2)',
        [category, 'Old category'],
      );
      await client.query(
        'INSERT INTO outfit_categories(id,outfit_category_name) VALUES($1,$2)',
        [outfitCategory, 'Old style'],
      );
      await client.query(
        'INSERT INTO outfits(id,outfit_name,outfit_category_id,shirt,shirt_link,is_verified,updated_at) VALUES($1,$2,$3,$4,$5,true,now())',
        [
          outfit,
          'Old outfit',
          outfitCategory,
          'Old shirt',
          'https://example.test/shirt',
        ],
      );
      await client.query(
        'INSERT INTO product_histories(id,user_id,product_link) VALUES($1,$2,$3)',
        [history, user, 'https://example.test/history'],
      );
      await client.query(
        'INSERT INTO product_bookmarks(id,product_bookmark_user_id,product_bookmark_product_name,product_bookmark_product_link,category_id) VALUES($1,$2,$3,$4,$5)',
        [bookmark, user, 'Old item', 'https://example.test/bookmark', category],
      );
      await client.query(
        'INSERT INTO outfit_stars(id,stars,outfit_id,evaluator,updated_at) VALUES($1,5,$2,$3,now())',
        [star, outfit, user],
      );
      await client.query(
        'INSERT INTO rejected_outfits(id,outfit_id,verified_at) VALUES($1,$2,now())',
        [randomUUID(), outfit],
      );
      await client.query(
        'INSERT INTO outfit_bookmarks(id,outfit_id,bookmark_user_id) VALUES($1,$2,$3)',
        [randomUUID(), outfit, user],
      );
      await client.query(
        'INSERT INTO report_categories(id,report_category_name) VALUES($1,$2)',
        [reportCategory, 'Old report'],
      );
      await client.query(
        'INSERT INTO contact_categories(id,contact_category_name) VALUES($1,$2)',
        [contactCategory, 'Old contact'],
      );
      await client.query(
        "INSERT INTO reports(id,reason,target_type,target_id,report_category_id,reporter_id,complete,completed_at) VALUES($1,$2,'OUTFIT',$3,$4,$5,true,now())",
        [report, 'Old reason', outfit, reportCategory, user],
      );
      await client.query(
        'INSERT INTO contacts(id,reason,contact_category_id,contact_user_id,complete,completed_at) VALUES($1,$2,$3,$4,true,now())',
        [contact, 'Old question', contactCategory, user],
      );
      await client.query(
        "INSERT INTO audit_logs(id,actor_id,action,target_type,target_id) VALUES($1,$2,'VERIFY','outfit',$3)",
        [randomUUID(), user, outfit],
      );
    });
    try {
      expect(
        await db.prisma.outfit.findUnique({
          where: { id: outfit },
          include: {
            items: true,
            categories: true,
            stars: true,
            bookmarks: true,
            rejectionLog: true,
          },
        }),
      ).toMatchObject({
        authorId: null,
        status: 'PENDING',
        name: 'Old outfit',
        items: [
          {
            name: 'Old shirt',
            link: 'https://example.test/shirt',
            type: 'TOP',
          },
        ],
        categories: [{ id: outfitCategory, name: 'Old style' }],
        stars: [{ evaluatorId: user, stars: 5 }],
        bookmarks: [{ bookmarkUserId: user }],
        rejectionLog: [{ reviewerId: null }],
      });
      expect(
        await db.prisma.productBookmark.findUnique({
          where: { id: bookmark },
          include: { legacyCategory: true },
        }),
      ).toMatchObject({
        userId: user,
        productId: null,
        legacyProductName: 'Old item',
        legacyCategory: { name: 'Old category' },
      });
      expect(
        await db.prisma.productHistory.findUnique({ where: { id: history } }),
      ).toMatchObject({
        userId: user,
        productId: null,
        legacyProductLink: 'https://example.test/history',
      });
      expect(
        await db.prisma.report.findUnique({
          where: { id: report },
          include: { category: true },
        }),
      ).toMatchObject({
        status: 'RESOLVED',
        reporterId: user,
        category: { name: 'Old report' },
      });
      const inquiry = await db.prisma.contact.findUniqueOrThrow({
        where: { id: contact },
        include: { category: true },
      });
      expect(inquiry).toMatchObject({
        status: 'RESOLVED',
        contactUserId: user,
        category: { name: 'Old contact' },
      });
      expect(inquiry.readAt).toEqual(inquiry.completedAt);
      expect(
        await db.prisma.auditLog.count({ where: { action: 'VERIFY' } }),
      ).toBe(1);
      expect(await db.prisma.discordNotification.count()).toBe(0);
      // Exercise the newly reconciled table through the generated client.
      expect(await db.prisma.productOfferVariant.count()).toBe(0);
    } finally {
      await db.cleanup();
    }
  });
});
