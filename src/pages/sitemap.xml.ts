import { apps, services } from "../data/catalog";

const site = "https://lazysoft.ru";
const staticPaths = ["/", "/services/", "/apps/", "/about/", "/articles/", "/contact/", "/mvp-za-3-dnya/"];

export const GET = () => {
  const urls = [
    ...staticPaths,
    ...services.map((service) => `/services/${service.slug}/`),
    ...apps.map((app) => `/apps/${app.slug}/`),
  ];

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((path) => `  <url><loc>${site}${path}</loc></url>`).join("\n")}
</urlset>`;

  return new Response(body, {
    headers: { "Content-Type": "application/xml; charset=utf-8" },
  });
};
