/**
 * companyService.js — tenant resolution.
 *
 * The API is single-tenant in the demo (one seeded company) but every query is
 * already scoped by company_id. Requests may target a tenant explicitly with
 * `?companyId=` or implicitly resolve to the first company in the database.
 */
"use strict";

const companyRepository = require("../repositories/subscriptionRepository");
const { HttpError } = require("../utils/httpError");

/**
 * @param {number|null} requestedCompanyId
 * @returns {Promise<object>} the company row (throws 404 when it does not exist)
 */
async function resolveCompany(requestedCompanyId = null) {
  if (requestedCompanyId !== null) {
    const company = await companyRepository.findCompanyById(requestedCompanyId);
    if (!company) throw HttpError.notFound(`Company ${requestedCompanyId} not found`);
    return company;
  }

  const companies = await companyRepository.listCompanies();
  if (companies.length === 0) {
    throw new HttpError(503, "No company data found. Run: node server/src/db/seed.js", {
      code: "not_seeded",
    });
  }
  const [company] = companies;
  return companyRepository.findCompanyById(company.id);
}

async function listCompanies() {
  return companyRepository.listCompanies();
}

module.exports = { resolveCompany, listCompanies };
