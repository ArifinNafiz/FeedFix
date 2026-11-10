const themeToggle = document.getElementById("themeToggle");

// Load the previously saved theme
const savedTheme = localStorage.getItem("feedfix-theme");

if (savedTheme === "dark") {
  document.body.classList.add("dark");
}

// Set the correct button label on page load
themeToggle.textContent = document.body.classList.contains("dark")
  ? "Light mode"
  : "Dark mode";

// Switch themes when the button is clicked
themeToggle.addEventListener("click", () => {
  document.body.classList.toggle("dark");

  const isDarkMode = document.body.classList.contains("dark");

  themeToggle.textContent = isDarkMode ? "Light mode" : "Dark mode";

  // Save the selected theme
  localStorage.setItem("feedfix-theme", isDarkMode ? "dark" : "light");
});

function createIssue({
  location,
  field,
  message,
  explanation,
  recommendedAction = "",
  severity = "warning",
  fix = null,
}) {
  return {
    location,
    field,
    message,
    explanation,
    recommendedAction,
    severity,
    fix,
  };
}

function applyFeedFix(issue) {
  if (!issue || !issue.fix) {
    return false;
  }

  const fix = issue.fix;

  if (fix.type !== "replace-cell") {
    return false;
  }

  if (
    !Number.isInteger(fix.rowIndex) ||
    fix.rowIndex < 0 ||
    fix.rowIndex >= workingData.length
  ) {
    return false;
  }

  const row = workingData[fix.rowIndex];

  if (!Object.prototype.hasOwnProperty.call(row, fix.column)) {
    return false;
  }

  const currentValue = String(row[fix.column] ?? "");

  if (currentValue !== fix.expectedValue) {
    return false;
  }

  row[fix.column] = fix.newValue;

  return true;
}

function validateProducts(data, headers, importMode) {
  const issues = [];

  // Normalize Shopify column names
  const headerMap = new Map();

  headers.forEach((header) => {
    let normalized = header.trim().toLowerCase();

    // Support older Shopify CSV headers
    if (normalized === "handle") {
      normalized = "url handle";
    }

    if (normalized === "variant sku") {
      normalized = "sku";
    }

    if (normalized === "variant grams") {
      normalized = "weight value (grams)";
    }

    headerMap.set(normalized, header);
  });

  const hasColumn = (name) => headerMap.has(name);

  const addIssue = (field, message, explanation, recommendedAction) => {
    issues.push(
      createIssue({
        location: "File",
        field,
        message,
        explanation,
        recommendedAction,
        severity: "error",
      }),
    );
  };

  // RULE 1: New product imports
  if (importMode === "new") {
    if (!hasColumn("title")) {
      addIssue(
        "Title",
        "Missing required column: Title",
        "Shopify requires a Title column when importing new products. Add this column to your CSV.",
        "Add a column named Title to your CSV and provide a title for each product.",
      );
    }

    // Check whether the file contains actual product variants
    const variantColumns = ["option1 value", "option2 value", "option3 value"];

    const hasVariants = data.some((row) => {
      return variantColumns.some((column) => {
        const originalHeader = headerMap.get(column);

        if (!originalHeader) {
          return false;
        }

        const value = String(row[originalHeader] ?? "")
          .trim()
          .toLowerCase();

        return value !== "" && value !== "default title";
      });
    });

    if (hasVariants && !hasColumn("url handle")) {
      addIssue(
        "URL handle",
        "Missing required column: URL handle",
        "You're importing product variants, but your CSV doesn't contain a URL handle column. Shopify requires this column when adding variants.",
        "Add a URL handle column and provide the same product handle for all rows belonging to that product.",
      );
    }
  }

  // RULE 2: Existing product updates
  if (importMode === "update") {
    if (!hasColumn("url handle")) {
      addIssue(
        "URL handle",
        "Missing required column: URL handle",
        "Shopify needs the URL handle to identify which existing product you're updating.",
        "Add a URL handle column and enter the handle of each existing product you want to update.",
      );
    }

    if (!hasColumn("title")) {
      addIssue(
        "Title",
        "Missing required column: Title",
        "Shopify requires the Title column when updating existing products.",
        "Add a column named Title to your CSV.",
      );
    }

    // RULE 3: Variant data dependencies
    const updatesVariantData =
      hasColumn("sku") || hasColumn("weight value (grams)");

    if (updatesVariantData) {
      if (!hasColumn("option1 name")) {
        addIssue(
          "Option1 name",
          "Missing variant identification column",
          "Your CSV includes SKU or weight data but lacks Option1 name. Shopify uses product option information to identify the corresponding variant.",
          "Add the Option1 name column with the option name used by each product, such as Color or Size.",
        );
      }

      if (!hasColumn("option1 value")) {
        addIssue(
          "Option1 value",
          "Missing variant identification column",
          "Your CSV includes SKU or weight data but lacks Option1 value. Without the variant option information, Shopify may create a default variant and delete existing variants.",
          "Add the Option1 value column with the corresponding variant value, such as Blue or Large.",
        );
      }
    }
  }

  return issues;
}

function validateProductRows(data, headers, importMode) {
  const issues = [];

  const handleHeader = headers.find((header) => {
    const normalized = header.trim().toLowerCase();

    return normalized === "url handle" || normalized === "handle";
  });

  // The existing file-level validator handles missing columns.
  if (!handleHeader) {
    return issues;
  }

  const variantHeaders = headers.filter((header) => {
    const normalized = header.trim().toLowerCase();

    return ["option1 value", "option2 value", "option3 value"].includes(
      normalized,
    );
  });

  data.forEach((row, index) => {
    const handle = String(row[handleHeader] ?? "").trim();

    const rowNumber = index + 2;

    const hasVariantData = variantHeaders.some((header) => {
      const value = String(row[header] ?? "")
        .trim()
        .toLowerCase();

      return value !== "" && value !== "default title";
    });

    let shouldCheckHandle = false;

    if (importMode === "update") {
      shouldCheckHandle = true;
    }

    if (importMode === "new" && hasVariantData) {
      shouldCheckHandle = true;
    }

    if (shouldCheckHandle && !handle) {
      issues.push(
        createIssue({
          location: `Row ${rowNumber}`,
          field: "URL handle",
          message: "Missing URL handle in row",
          explanation:
            "This row contains product or variant data but has no URL handle. Shopify uses the handle to associate this row with the correct product. Add the matching product handle.",
          recommendedAction: `Enter the correct URL handle in row ${rowNumber}. Use the same handle as the other rows belonging to this product.`,
          severity: "error",
        }),
      );
    }
  });

  return issues;
}

function validateDuplicateVariants(data, headers) {
  const issues = [];

  const handleHeader = headers.find((header) => {
    const normalized = header.trim().toLowerCase();

    return normalized === "url handle" || normalized === "handle";
  });

  const optionHeaders = [1, 2, 3]
    .map((number) =>
      headers.find(
        (header) => header.trim().toLowerCase() === `option${number} value`,
      ),
    )
    .filter(Boolean);

  if (!handleHeader || optionHeaders.length === 0) {
    return issues;
  }

  const seenVariants = new Map();

  data.forEach((row, index) => {
    const handle = String(row[handleHeader] ?? "").trim();

    if (!handle) return;

    const optionValues = optionHeaders.map((header) =>
      String(row[header] ?? "").trim(),
    );

    if (!optionValues.some((value) => value !== "")) return;

    const variantKey = JSON.stringify([handle, ...optionValues]);
    const rowNumber = index + 2;

    if (seenVariants.has(variantKey)) {
      const original = seenVariants.get(variantKey);

      const optionDescription = optionHeaders
        .map((header, i) => `${header}: ${optionValues[i] || "(blank)"}`)
        .join(", ");

      const duplicateIssue = createIssue({
        location: `Rows ${original.rowNumber} and ${rowNumber}`,
        field: "Variant options",
        message: "Duplicate variant combination",
        explanation: `Rows ${original.rowNumber} and ${rowNumber} belong to the same product and have identical variant options: ${optionDescription}. Shopify requires each variant combination to be unique.`,
        recommendedAction: `Compare both rows, including their SKU, price, and inventory data. If they represent the same variant, decide which row to keep. If they represent different variants, correct the option values.`,
        severity: "error",
      });

      // Store actual indexes for the resolution controls.
      duplicateIssue.duplicateRows = [original.rowIndex, index];

      issues.push(duplicateIssue);
    } else {
      seenVariants.set(variantKey, {
        rowNumber,
        rowIndex: index,
        row,
      });
    }
  });

  return issues;
}

function validateProductTitles(data, headers, importMode) {
  const issues = [];

  const titleHeader = headers.find(
    (header) => header.trim().toLowerCase() === "title",
  );

  const handleHeader = headers.find((header) => {
    const normalized = header.trim().toLowerCase();

    return normalized === "url handle" || normalized === "handle";
  });

  // The file-level validator already checks missing columns.
  if (!titleHeader) {
    return issues;
  }

  // Without handles, we cannot reliably group existing products.
  if (!handleHeader && importMode === "update") {
    return issues;
  }

  const products = new Map();

  data.forEach((row, index) => {
    const title = String(row[titleHeader] ?? "").trim();
    const handle = handleHeader ? String(row[handleHeader] ?? "").trim() : "";

    const rowNumber = index + 2;

    if (!handle) {
      return;
    }

    if (!products.has(handle)) {
      products.set(handle, {
        firstRow: rowNumber,
        hasTitle: false,
      });
    }

    if (title !== "") {
      products.get(handle).hasTitle = true;
    }
  });

  products.forEach((product, handle) => {
    if (!product.hasTitle) {
      issues.push(
        createIssue({
          location: `Row ${product.firstRow}`,
          field: "Title",
          message: "Product is missing a title",
          explanation: `No row belonging to product "${handle}" contains a title. Shopify requires a title for each product.`,
          recommendedAction: `Enter the product title in the first row of product "${handle}".`,
          severity: "error",
        }),
      );
    }
  });

  return issues;
}

function validateVariantOptions(data, headers) {
  const issues = [];

  const handleColumn = headers.find((header) =>
    ["handle", "url handle"].includes(header.trim().toLowerCase()),
  );

  const optionColumns = [1, 2, 3].map((number) => ({
    name: headers.find(
      (header) => header.trim().toLowerCase() === `option${number} name`,
    ),
    value: headers.find(
      (header) => header.trim().toLowerCase() === `option${number} value`,
    ),
  }));

  const productGroups = new Map();

  data.forEach((row, index) => {
    const handle = handleColumn ? String(row[handleColumn] ?? "").trim() : "";

    const groupKey = handle || `row-${index}`;

    if (!productGroups.has(groupKey)) {
      productGroups.set(groupKey, []);
    }

    productGroups.get(groupKey).push({ row, index });
  });

  productGroups.forEach((productRows) => {
    optionColumns.forEach((option, optionIndex) => {
      if (!option.name || !option.value) {
        return;
      }

      const optionName = productRows
        .map(({ row }) => String(row[option.name] ?? "").trim())
        .find((name) => name !== "");

      if (!optionName) {
        return;
      }

      productRows.forEach(({ row, index }) => {
        const optionValue = String(row[option.value] ?? "").trim();

        if (optionValue === "") {
          issues.push(
            createIssue({
              location: `Row ${index + 2}`,
              field: `Option${optionIndex + 1} Value`,
              message: "Variant option is missing a value",
              explanation: `The option "${optionName}" has no value in this variant row.`,
              recommendedAction: `Enter a value for "${optionName}" or correct this variant row.`,
              severity: "error",
            }),
          );
        }
      });
    });
  });

  return issues;
}

function validateInconsistentOptionNames(data, headers) {
  const issues = [];

  const handleHeader = headers.find((header) => {
    const normalized = header.trim().toLowerCase();
    return normalized === "url handle" || normalized === "handle";
  });

  if (!handleHeader) {
    return issues;
  }

  const optionNameHeaders = [1, 2, 3].map((number) =>
    headers.find(
      (header) => header.trim().toLowerCase() === `option${number} name`,
    ),
  );

  const products = new Map();

  data.forEach((row, index) => {
    const handle = String(row[handleHeader] ?? "").trim();

    if (!handle) return;

    if (!products.has(handle)) {
      products.set(handle, []);
    }

    products.get(handle).push({
      row,
      rowNumber: index + 2,
    });
  });

  products.forEach((productRows, handle) => {
    optionNameHeaders.forEach((header, optionIndex) => {
      if (!header) return;

      const optionLabel = `Option ${optionIndex + 1}`;

      const establishedNames = new Set();

      productRows.forEach(({ row }) => {
        const name = String(row[header] ?? "")
          .trim()
          .toLowerCase();

        if (name) establishedNames.add(name);
      });

      if (establishedNames.size <= 1) return;

      const expectedName = String(
        productRows.find(({ row }) => String(row[header] ?? "").trim())?.row[
          header
        ] ?? "",
      ).trim();

      productRows.forEach(({ row, rowNumber }) => {
        const actualName = String(row[header] ?? "").trim();

        if (
          actualName &&
          actualName.toLowerCase() !== expectedName.toLowerCase()
        ) {
          issues.push(
            createIssue({
              location: `Row ${rowNumber}`,
              field: `Option${optionIndex + 1} Name`,
              message: "Inconsistent variant option name",
              explanation: `Product "${handle}" uses "${expectedName}" as its ${optionLabel} name, but this row uses "${actualName}".`,
              recommendedAction: `Use "${expectedName}" consistently for this product's ${optionLabel.toLowerCase()}.`,
              fix: {
                type: "replace-cell",
                rowIndex: rowNumber - 2,
                column: header,
                expectedValue: actualName,
                newValue: expectedName,
              },
              severity: "error",
            }),
          );
        }
      });
    });
  });

  return issues;
}

function validateConflictingProductTitles(data, headers) {
  const issues = [];

  const titleHeader = headers.find(
    (header) => header.trim().toLowerCase() === "title",
  );

  const handleHeader = headers.find((header) => {
    const normalized = header.trim().toLowerCase();

    return normalized === "url handle" || normalized === "handle";
  });

  if (!titleHeader || !handleHeader) {
    return issues;
  }

  const products = new Map();

  data.forEach((row, index) => {
    const handle = String(row[handleHeader] ?? "").trim();
    const title = String(row[titleHeader] ?? "").trim();

    if (!handle || !title) return;

    if (!products.has(handle)) {
      products.set(handle, {
        establishedTitle: title,
        firstRow: index + 2,
        rows: [],
      });
    }

    products.get(handle).rows.push({
      title,
      rowNumber: index + 2,
    });
  });

  products.forEach((product, handle) => {
    product.rows.forEach(({ title, rowNumber }) => {
      if (title === product.establishedTitle) {
        return;
      }

      issues.push(
        createIssue({
          location: `Row ${rowNumber}`,
          field: "Title",
          message: "Conflicting product title",
          explanation: `Product "${handle}" has an established title of "${product.establishedTitle}", but this row uses "${title}".`,
          recommendedAction: `Use "${product.establishedTitle}" to keep the product title consistent across all its rows.`,
          fix: {
            type: "replace-cell",
            rowIndex: rowNumber - 2,
            column: "Title",
            expectedValue: title,
            newValue: product.establishedTitle,
          },
          severity: "error",
        }),
      );
    });
  });

  return issues;
}

function validateProductPrices(data, headers) {
  const issues = [];

  const priceColumns = [
    {
      names: ["price", "variant price"],
      label: "Price",
    },
    {
      names: [
        "compare-at price",
        "variant compare at price",
        "compare at price",
      ],
      label: "Compare-at price",
    },
  ];

  const availableColumns = priceColumns.map((priceColumn) => ({
    ...priceColumn,
    column: headers.find((header) =>
      priceColumn.names.includes(header.trim().toLowerCase()),
    ),
  }));

  data.forEach((row, index) => {
    availableColumns.forEach(({ column, label }) => {
      if (!column) return;

      const value = String(row[column] ?? "").trim();

      if (value === "") return;

      const validPrice = /^-?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(value);

      if (!validPrice) {
        issues.push(
          createIssue({
            location: `Row ${index + 2}`,
            field: label,
            message: `Invalid ${label.toLowerCase()} format`,
            explanation: `The value "${value}" is not a valid monetary number. Shopify requires prices without currency symbols.`,
            recommendedAction:
              "Enter the monetary value without a currency symbol, for example 19.99.",
            severity: "error",
          }),
        );
      }
    });
  });

  return issues;
}

function runValidation(data, headers, importMode, parsingErrors = []) {
  const fileIssues = validateProducts(data, headers, importMode);

  const rowIssues = validateProductRows(data, headers, importMode);

  const titleIssues = validateProductTitles(data, headers, importMode);

  const conflictingTitleIssues = validateConflictingProductTitles(
    data,
    headers,
  );

  const variantOptionIssues = validateVariantOptions(data, headers);

  const inconsistentOptionIssues = validateInconsistentOptionNames(
    data,
    headers,
  );

  const duplicateIssues = validateDuplicateVariants(data, headers);

  const priceIssues = validateProductPrices(data, headers);

  const parsingIssues = parsingErrors.map((error) => {
    const rowNumber = Number.isInteger(error.row) ? error.row + 2 : null;

    let recommendedAction =
      "Review the CSV formatting and make sure every row matches the column structure defined by the header.";

    if (error.code === "TooManyFields") {
      recommendedAction =
        "Check this row for extra values. Remove the extra value or add the appropriate column header.";
    }

    if (error.code === "TooFewFields") {
      recommendedAction = "Check this row for missing values or separators.";
    }

    return createIssue({
      location: rowNumber ? `Row ${rowNumber}` : "File",
      field: "CSV structure",
      message: "Inconsistent CSV column structure",
      explanation: error.message,
      recommendedAction,
      severity: "error",
    });
  });

  return [
    ...fileIssues,
    ...rowIssues,
    ...titleIssues,
    ...conflictingTitleIssues,
    ...variantOptionIssues,
    ...inconsistentOptionIssues,
    ...duplicateIssues,
    ...priceIssues,
    ...parsingIssues,
  ];
}

function renderPreviewTable(headers, tableBody) {
  const previewTable = document.getElementById("previewTable");
  const tableHead = previewTable.querySelector("thead");

  tableHead.innerHTML = "";
  tableBody.innerHTML = "";

  const headerRow = document.createElement("tr");

  headers.forEach((header) => {
    const th = document.createElement("th");
    th.textContent = header;
    headerRow.appendChild(th);
  });

  tableHead.appendChild(headerRow);

  workingData.forEach((row) => {
    const tr = document.createElement("tr");

    headers.forEach((header) => {
      const td = document.createElement("td");
      td.textContent = row[header] ?? "";
      tr.appendChild(td);
    });

    tableBody.appendChild(tr);
  });

  const rowCount = document.getElementById("rowCount");
  rowCount.textContent = `${workingData.length} rows`;
}

function groupProducts(data, headers) {
  // Find the URL handle column
  const handleHeader = headers.find((header) => {
    const normalized = header.trim().toLowerCase();

    return normalized === "url handle" || normalized === "handle";
  });

  const groups = new Map();
  const ungroupedRows = [];

  data.forEach((row, index) => {
    const handle = handleHeader ? String(row[handleHeader] ?? "").trim() : "";

    const rowInfo = {
      row,
      rowNumber: index + 2,
    };

    // Rows without a handle cannot be reliably grouped
    if (!handle) {
      ungroupedRows.push(rowInfo);
      return;
    }

    // Create a product group if this handle is new
    if (!groups.has(handle)) {
      groups.set(handle, {
        handle,
        rows: [],
      });
    }

    // Add this row to its product group
    groups.get(handle).rows.push(rowInfo);
  });

  return {
    products: Array.from(groups.values()),
    ungroupedRows,
  };
}

let originalData = [];
let workingData = [];
let currentHeaders = [];
let currentFileName = "feedfix-cleaned.csv";
let currentParsingErrors = [];

function renderIssues(issues, headers, importMode, parsingErrors, tableBody) {
  const issuesSection = document.getElementById("issuesSection");
  const issueCount = document.getElementById("issueCount");
  const issuesList = document.getElementById("issuesList");

  issuesList.innerHTML = "";

  const getIssueSeverity = (issue) => {
    const validSeverities = ["error", "warning", "info"];

    return validSeverities.includes(issue.severity)
      ? issue.severity
      : "warning";
  };

  const getIssueCategory = (issue) => {
    const field = String(issue.field || "").toLowerCase();

    if (field.includes("csv structure")) return "CSV structure";
    if (field.includes("option") || field.includes("variant"))
      return "Variants";
    if (field.includes("handle") || field.includes("title"))
      return "Product structure";

    return "General";
  };

  const errorCount = issues.filter(
    (issue) => getIssueSeverity(issue) === "error",
  ).length;

  const warningCount = issues.filter(
    (issue) => getIssueSeverity(issue) === "warning",
  ).length;

  const infoCount = issues.filter(
    (issue) => getIssueSeverity(issue) === "info",
  ).length;

  issueCount.textContent = `${issues.length} issues · ${errorCount} errors · ${warningCount} warnings · ${infoCount} info`;

  // Check whether any approved corrections have changed the data
  const hasApprovedChanges =
    workingData.length !== originalData.length ||
    workingData.some((row, index) =>
      headers.some(
        (header) =>
          String(row[header] ?? "") !==
          String(originalData[index]?.[header] ?? ""),
      ),
    );

  // Show a reset button only when corrections have been made
  if (hasApprovedChanges) {
    const resetButton = document.createElement("button");

    resetButton.textContent = "Reset all changes";
    resetButton.classList.add("approve-fix-button");

    resetButton.addEventListener("click", () => {
      // Restore the original uploaded data
      workingData = originalData.map((row) => ({ ...row }));

      renderPreviewTable(headers, tableBody);

      // Revalidate the restored data
      const updatedIssues = runValidation(
        workingData,
        headers,
        importMode,
        parsingErrors,
      );

      // Rebuild the issue list
      renderIssues(
        updatedIssues,
        headers,
        importMode,
        parsingErrors,
        tableBody,
      );
    });

    issuesList.appendChild(resetButton);
  }

  issues.forEach((issue) => {
    const severity = getIssueSeverity(issue);
    const category = getIssueCategory(issue);

    const issueItem = document.createElement("div");
    issueItem.classList.add("issue-item");

    const metadata = document.createElement("div");
    metadata.classList.add("issue-meta");

    const severityBadge = document.createElement("span");
    severityBadge.classList.add("issue-severity", `severity-${severity}`);
    severityBadge.textContent =
      severity.charAt(0).toUpperCase() + severity.slice(1);

    const categoryBadge = document.createElement("span");
    categoryBadge.classList.add("issue-category");
    categoryBadge.textContent = category;

    const title = document.createElement("strong");
    title.textContent = issue.message;

    const explanation = document.createElement("p");
    explanation.textContent = `${issue.location} · ${issue.field}: ${issue.explanation}`;

    metadata.appendChild(severityBadge);
    metadata.appendChild(categoryBadge);

    issueItem.appendChild(metadata);
    issueItem.appendChild(title);
    issueItem.appendChild(explanation);

    if (issue.recommendedAction) {
      const action = document.createElement("p");
      action.classList.add("issue-action");
      action.textContent = `Recommended action: ${issue.recommendedAction}`;
      issueItem.appendChild(action);
    }

    if (Array.isArray(issue.duplicateRows)) {
      const [firstIndex, secondIndex] = issue.duplicateRows;

      const firstRow = workingData[firstIndex];
      const secondRow = workingData[secondIndex];

      if (firstRow && secondRow) {
        const comparison = document.createElement("div");
        comparison.classList.add("duplicate-comparison");

        const comparisonHeading = document.createElement("strong");
        comparisonHeading.textContent = "Compare duplicate rows";

        comparison.appendChild(comparisonHeading);

        const differences = headers.filter(
          (header) =>
            String(firstRow[header] ?? "").trim() !==
            String(secondRow[header] ?? "").trim(),
        );

        if (differences.length === 0) {
          const noDifferences = document.createElement("p");
          noDifferences.textContent = "Both rows contain identical data.";
          comparison.appendChild(noDifferences);
        } else {
          differences.forEach((header) => {
            const difference = document.createElement("div");
            difference.classList.add("duplicate-difference");

            const fieldName = document.createElement("strong");
            fieldName.textContent = header;

            const firstValue = document.createElement("p");
            firstValue.textContent = `Row ${firstIndex + 2}: ${firstRow[header] || "(blank)"}`;

            const secondValue = document.createElement("p");
            secondValue.textContent = `Row ${secondIndex + 2}: ${secondRow[header] || "(blank)"}`;

            difference.appendChild(fieldName);
            difference.appendChild(firstValue);
            difference.appendChild(secondValue);

            comparison.appendChild(difference);
          });
        }

        const resolutionActions = document.createElement("div");
        resolutionActions.classList.add("duplicate-resolution-actions");

        const createKeepButton = (keepIndex, removeIndex) => {
          const button = document.createElement("button");

          button.textContent = `Keep row ${keepIndex + 2} · remove row ${removeIndex + 2}`;

          button.classList.add("approve-fix-button");

          button.addEventListener("click", () => {
            // Remove only from the editable working copy.
            workingData.splice(removeIndex, 1);

            // Rebuild the preview.
            renderPreviewTable(headers, tableBody);

            // Revalidate the updated data.
            const updatedIssues = runValidation(
              workingData,
              headers,
              importMode,
              parsingErrors,
            );

            // Rebuild the issue list.
            renderIssues(
              updatedIssues,
              headers,
              importMode,
              parsingErrors,
              tableBody,
            );
          });

          return button;
        };

        resolutionActions.appendChild(
          createKeepButton(firstIndex, secondIndex),
        );

        resolutionActions.appendChild(
          createKeepButton(secondIndex, firstIndex),
        );

        comparison.appendChild(resolutionActions);
        issueItem.appendChild(comparison);
      }
    }

    if (issue.fix && issue.fix.type === "replace-cell") {
      const fixPreview = document.createElement("div");
      fixPreview.classList.add("fix-preview");

      const fixHeading = document.createElement("strong");
      fixHeading.textContent = "Suggested correction";

      const currentValue = document.createElement("p");
      currentValue.textContent = `Current value: ${workingData[issue.fix.rowIndex][issue.fix.column]}`;

      const newValue = document.createElement("p");
      newValue.textContent = `New value: ${issue.fix.newValue}`;

      const approveButton = document.createElement("button");
      approveButton.textContent = "Approve fix";
      approveButton.classList.add("approve-fix-button");

      approveButton.addEventListener("click", () => {
        const approved = applyFeedFix(issue);

        if (!approved) {
          approveButton.textContent = "Fix unavailable";
          approveButton.disabled = true;
          return;
        }

        // Update the matching cell in the preview table
        const columnIndex = headers.indexOf(issue.fix.column);
        const previewRow = tableBody.rows[issue.fix.rowIndex];

        if (previewRow && columnIndex !== -1) {
          previewRow.cells[columnIndex].textContent =
            workingData[issue.fix.rowIndex][issue.fix.column];
        }

        // Re-run every validator using the updated working data
        const updatedIssues = runValidation(
          workingData,
          headers,
          importMode,
          parsingErrors,
        );

        // Rebuild the complete issue list
        renderIssues(
          updatedIssues,
          headers,
          importMode,
          parsingErrors,
          tableBody,
        );
      });

      fixPreview.appendChild(fixHeading);
      fixPreview.appendChild(currentValue);
      fixPreview.appendChild(newValue);
      fixPreview.appendChild(approveButton);

      issueItem.appendChild(fixPreview);
    }

    if (
      issue.message === "Variant option is missing a value" ||
      issue.message === "Product is missing a title"
    ) {
      const editContainer = document.createElement("div");
      editContainer.classList.add("manual-edit-container");

      const editButton = document.createElement("button");
      editButton.textContent = "Edit value";
      editButton.classList.add("manual-edit-button");

      editButton.addEventListener("click", () => {
        const input = document.createElement("input");
        input.type = "text";
        input.placeholder = "Enter the correct value";

        const saveButton = document.createElement("button");
        saveButton.textContent = "Save value";

        editContainer.replaceChildren(input, saveButton);
        input.focus();

        saveButton.addEventListener("click", () => {
          const newValue = input.value.trim();

          if (!newValue) {
            input.focus();
            return;
          }

          const rowIndex = Number(issue.location.match(/\d+/)?.[0]) - 2;
          const column = headers.find(
            (header) =>
              header.trim().toLowerCase() === issue.field.trim().toLowerCase(),
          );

          if (
            !Number.isInteger(rowIndex) ||
            rowIndex < 0 ||
            !column ||
            !workingData[rowIndex]
          ) {
            return;
          }

          workingData[rowIndex][column] = newValue;

          renderPreviewTable(headers, tableBody);

          const updatedIssues = runValidation(
            workingData,
            headers,
            importMode,
            parsingErrors,
          );

          renderIssues(
            updatedIssues,
            headers,
            importMode,
            parsingErrors,
            tableBody,
          );
        });
      });

      editContainer.appendChild(editButton);
      issueItem.appendChild(editContainer);
    }

    issuesList.appendChild(issueItem);
  });

  if (issues.length === 0) {
    const successMessage = document.createElement("p");
    successMessage.textContent =
      "No issues found. Your CSV is ready for review!";
    successMessage.classList.add("no-issues-message");

    issuesList.appendChild(successMessage);
  }

  issuesSection.hidden = false;
}

const csvFileInput = document.getElementById("csvFile");
const fileStatus = document.getElementById("fileStatus");

const exportCsvButton = document.getElementById("exportCsvButton");
const exportStatus = document.getElementById("exportStatus");

const importModeSelect = document.getElementById("importMode");

importModeSelect.addEventListener("change", () => {
  if (currentHeaders.length === 0) {
    return;
  }

  const previewTable = document.getElementById("previewTable");
  const tableBody = previewTable.querySelector("tbody");

  const issues = runValidation(
    workingData,
    currentHeaders,
    importModeSelect.value,
    currentParsingErrors,
  );

  renderIssues(
    issues,
    currentHeaders,
    importModeSelect.value,
    currentParsingErrors,
    tableBody,
  );
});

exportCsvButton.addEventListener("click", () => {
  if (workingData.length === 0 || currentHeaders.length === 0) {
    exportStatus.textContent = "Please upload a CSV file first.";
    return;
  }

  // Convert the approved working data back into CSV
  if (currentParsingErrors.length > 0) {
    exportStatus.textContent = `Download blocked: ${currentParsingErrors.length} CSV formatting issue(s) must be resolved first. Re-upload a corrected CSV.`;

    return;
  }

  const csv = Papa.unparse(workingData, {
    columns: currentHeaders,
  });

  // Add a UTF-8 BOM for better spreadsheet compatibility
  const csvWithBom = "\uFEFF" + csv;

  const blob = new Blob([csvWithBom], {
    type: "text/csv;charset=utf-8;",
  });

  const downloadUrl = URL.createObjectURL(blob);

  const downloadLink = document.createElement("a");
  downloadLink.href = downloadUrl;
  downloadLink.download = currentFileName;

  document.body.appendChild(downloadLink);
  downloadLink.click();
  document.body.removeChild(downloadLink);

  setTimeout(() => {
    URL.revokeObjectURL(downloadUrl);
  }, 1000);

  const importMode = document.getElementById("importMode").value;

  const remainingIssues = runValidation(
    workingData,
    currentHeaders,
    importMode,
    currentParsingErrors,
  ).length;

  if (remainingIssues > 0) {
    exportStatus.textContent = `CSV downloaded. Warning: ${remainingIssues} unresolved issue(s) remain.`;
  } else {
    exportStatus.textContent =
      "CSV downloaded successfully. No validation issues remain.";
  }
});

csvFileInput.addEventListener("change", (event) => {
  const file = event.target.files[0];

  if (!file) {
    return;
  }

  // Clear the previous upload before processing a new file.
  document.getElementById("previewSection").hidden = true;
  document.getElementById("issuesSection").hidden = true;

  originalData = [];
  workingData = [];
  currentHeaders = [];

  exportStatus.textContent =
    "Only changes made or approved in FeedFix will be included in your download.";

  if (file.size === 0) {
    fileStatus.textContent = "This file is empty. Please choose another CSV.";
    fileStatus.classList.remove("loading");
    return;
  }

  if (!file.name.toLowerCase().endsWith(".csv")) {
    fileStatus.textContent = "Please select a CSV file.";
    csvFileInput.value = "";
    return;
  }

  fileStatus.textContent = `Reading ${file.name}...`;
  fileStatus.classList.add("loading");

  Papa.parse(file, {
    header: true,
    skipEmptyLines: true,

    complete: (results) => {
      fileStatus.classList.remove("loading");

      const data = results.data;
      currentParsingErrors = results.errors;

      originalData = data.map((row) => ({ ...row }));

      workingData = data.map((row) => ({ ...row }));

      fileStatus.textContent =
        results.errors.length > 0
          ? `Loaded ${data.length} rows with ${results.errors.length} parsing issue(s).`
          : `Successfully loaded ${data.length} rows from ${file.name}.`;

      const previewSection = document.getElementById("previewSection");
      const previewTable = document.getElementById("previewTable");
      const rowCount = document.getElementById("rowCount");
      const previewWarning = document.getElementById("previewWarning");

      const headers = results.meta.fields || [];

      if (headers.length === 0) {
        fileStatus.textContent =
          "No column headers found. Please upload a valid product CSV.";

        previewWarning.hidden = true;
        fileStatus.classList.remove("loading");
        return;
      }

      currentHeaders = headers;

      currentFileName = file.name.replace(/\.csv$/i, "") + "-cleaned.csv";

      const productGroups = groupProducts(data, headers);

      const tableBody = previewTable.querySelector("tbody");

      renderPreviewTable(headers, tableBody);

      rowCount.textContent = `${data.length} rows`;

      previewSection.hidden = false;

      previewWarning.hidden = results.errors.length === 0;

      const importMode = document.getElementById("importMode").value;

      const issues = runValidation(
        workingData,
        headers,
        importMode,
        results.errors,
      );

      renderIssues(issues, headers, importMode, results.errors, tableBody);
    },

    error: (error) => {
      fileStatus.classList.remove("loading");
      fileStatus.textContent = `Could not read this file: ${error.message}`;
    },
  });
});
