import fs from "node:fs";
import http from "node:http";
import path from "node:path";

import {
  createAuction,
  getAuctionById,
  getCreateFormDefaults,
  getDashboardMetrics,
  getStoreErrorMessage,
  isStoreError,
  listAuctions,
  listSuppliers,
  submitBid,
} from "./src/server/store.js";
import {
  renderAuctionDetailPage,
  renderCreateAuctionPage,
  renderDashboardPage,
  renderDocumentPage,
  renderNotFoundPage,
} from "./src/server/pages.js";
import { buildQueryString } from "./src/utils/format.js";

const publicDirectory = path.join(process.cwd(), "public");
const documentationDirectory = path.join(process.cwd(), "docs");
const port = Number(process.env.PORT || 3000);

function sendHtml(response, statusCode, html) {
  response.writeHead(statusCode, {
    "Content-Type": "text/html; charset=utf-8",
  });
  response.end(html);
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(payload, null, 2));
}

function sendRedirect(response, location) {
  response.writeHead(303, {
    Location: location,
  });
  response.end();
}

function sendFile(response, statusCode, filePath, contentType) {
  response.writeHead(statusCode, {
    "Content-Type": contentType,
  });
  response.end(fs.readFileSync(filePath));
}

async function parseRequestPayload(request) {
  const chunks = [];

  for await (const chunk of request) {
    chunks.push(Buffer.from(chunk));
  }

  const body = Buffer.concat(chunks).toString("utf8");
  const contentType = request.headers["content-type"] ?? "";

  if (contentType.includes("application/json")) {
    return body ? JSON.parse(body) : {};
  }

  const searchParams = new URLSearchParams(body);
  const payload = {};

  for (const key of new Set(searchParams.keys())) {
    const values = searchParams.getAll(key);
    payload[key] = values.length > 1 ? values : values[0];
  }

  return payload;
}

function isDocumentationRequest(pathname) {
  return (
    pathname === "/docs/architecture" ||
    pathname === "/docs/schema" ||
    pathname === "/docs/improvements"
  );
}

function getDocumentDescriptor(pathname) {
  if (pathname === "/docs/architecture") {
    return {
      title: "Architecture",
      fileName: "architecture.md",
    };
  }

  if (pathname === "/docs/schema") {
    return {
      title: "Schema Design",
      fileName: "schema-design.md",
    };
  }

  if (pathname === "/docs/improvements") {
    return {
      title: "Improvements",
      fileName: "improvements.md",
    };
  }

  return null;
}

function serveStaticAsset(response, pathname) {
  const filePath = path.join(publicDirectory, pathname.replace(/^\//, ""));

  if (!filePath.startsWith(publicDirectory) || !fs.existsSync(filePath)) {
    return false;
  }

  const extension = path.extname(filePath);
  const contentTypes = {
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
  };

  sendFile(response, 200, filePath, contentTypes[extension] ?? "application/octet-stream");
  return true;
}

async function handleFormSubmission(response, pathname, action) {
  try {
    const result = await action();
    return result;
  } catch (error) {
    const query = buildQueryString({
      error: getStoreErrorMessage(error),
    });
    sendRedirect(response, `${pathname}${query}`);
    return null;
  }
}

const server = http.createServer(async (request, response) => {
  const requestUrl = new URL(request.url ?? "/", `http://${request.headers.host ?? `localhost:${port}`}`);
  const pathname = requestUrl.pathname;

  try {
    if (pathname.startsWith("/public/")) {
      if (serveStaticAsset(response, pathname.replace("/public", ""))) {
        return;
      }
    }

    if (pathname === "/styles.css" || pathname === "/client.js") {
      if (serveStaticAsset(response, pathname)) {
        return;
      }
    }

    if (request.method === "GET" && pathname === "/") {
      const auctions = listAuctions(new Date());
      sendHtml(
        response,
        200,
        renderDashboardPage({
          auctions,
          metrics: getDashboardMetrics(auctions),
          flash: {
            notice: requestUrl.searchParams.get("notice"),
            error: requestUrl.searchParams.get("error"),
          },
        }),
      );
      return;
    }

    if (request.method === "GET" && pathname === "/rfqs/new") {
      sendHtml(
        response,
        200,
        renderCreateAuctionPage({
          defaults: getCreateFormDefaults(new Date()),
          flash: {
            notice: requestUrl.searchParams.get("notice"),
            error: requestUrl.searchParams.get("error"),
          },
        }),
      );
      return;
    }

    if (request.method === "POST" && pathname === "/rfqs") {
      const payload = await parseRequestPayload(request);
      const result = await handleFormSubmission(response, "/rfqs/new", () => createAuction(payload));

      if (result) {
        sendRedirect(
          response,
          `/${buildQueryString({
            notice: `${result.referenceId} created successfully.`,
          })}`,
        );
      }
      return;
    }

    const auctionMatch = pathname.match(/^\/auctions\/(\d+)$/);
    if (request.method === "GET" && auctionMatch) {
      const auctionId = Number(auctionMatch[1]);
      const auction = getAuctionById(auctionId, new Date());
      sendHtml(
        response,
        200,
        renderAuctionDetailPage({
          auction,
          suppliers: listSuppliers(),
          flash: {
            notice: requestUrl.searchParams.get("notice"),
            error: requestUrl.searchParams.get("error"),
          },
        }),
      );
      return;
    }

    const bidMatch = pathname.match(/^\/auctions\/(\d+)\/bids$/);
    if (request.method === "POST" && bidMatch) {
      const auctionId = Number(bidMatch[1]);
      const payload = await parseRequestPayload(request);
      const result = await handleFormSubmission(response, `/auctions/${auctionId}`, () =>
        submitBid(auctionId, payload),
      );

      if (result) {
        sendRedirect(
          response,
          `/auctions/${auctionId}${buildQueryString({
            notice: result.extension.shouldExtend
              ? `Bid accepted. Auction extended to ${result.extension.nextCloseAt}.`
              : "Bid accepted.",
          })}`,
        );
      }
      return;
    }

    if (request.method === "GET" && isDocumentationRequest(pathname)) {
      const descriptor = getDocumentDescriptor(pathname);
      const markdown = fs.readFileSync(path.join(documentationDirectory, descriptor.fileName), "utf8");
      sendHtml(
        response,
        200,
        renderDocumentPage({
          title: descriptor.title,
          markdown,
        }),
      );
      return;
    }

    if (request.method === "GET" && pathname === "/api/health") {
      sendJson(response, 200, {
        status: "ok",
        time: new Date().toISOString(),
      });
      return;
    }

    if (request.method === "GET" && pathname === "/api/auctions") {
      sendJson(response, 200, {
        data: listAuctions(new Date()),
      });
      return;
    }

    const apiAuctionMatch = pathname.match(/^\/api\/auctions\/(\d+)$/);
    if (request.method === "GET" && apiAuctionMatch) {
      sendJson(response, 200, {
        data: getAuctionById(Number(apiAuctionMatch[1]), new Date()),
      });
      return;
    }

    if (request.method === "POST" && pathname === "/api/rfqs") {
      const payload = await parseRequestPayload(request);
      const result = createAuction(payload);
      sendJson(response, 201, {
        message: "RFQ created successfully.",
        data: result,
      });
      return;
    }

    const apiBidMatch = pathname.match(/^\/api\/auctions\/(\d+)\/bids$/);
    if (request.method === "POST" && apiBidMatch) {
      const payload = await parseRequestPayload(request);
      const result = submitBid(Number(apiBidMatch[1]), payload);
      sendJson(response, 201, {
        message: "Bid submitted successfully.",
        data: result,
      });
      return;
    }

    sendHtml(response, 404, renderNotFoundPage());
  } catch (error) {
    if (pathname.startsWith("/api/")) {
      sendJson(response, isStoreError(error) ? error.statusCode : 500, {
        error: getStoreErrorMessage(error),
      });
      return;
    }

    sendHtml(response, isStoreError(error) ? error.statusCode : 500, renderNotFoundPage({
      error: getStoreErrorMessage(error),
    }));
  }
});

server.listen(port, () => {
  console.log(`British Auction RFQ app running at http://localhost:${port}`);
});
