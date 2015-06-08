/// <amd-dependency path="datatables" />
/// <amd-dependency path="datatables-bootstrap3" />
/// <amd-dependency path="datatables-responsive" />

/// <reference path="../jquery.d.ts"/>
/// <reference path="../jquery.dataTables.d.ts" />

// A *TypeScript* KnockoutJS binding handler for the html tables javascript library DataTables.
// Ported for use from original author Lucas Martin (http://www.cogshift.com)             

import $ = require("jquery");
import ko = require("knockout");

var onInitialisingEventName: string = "ko_bindingHandlers_dataTable_onInitialising";
var dataTablesInstanceDataKey: string = "ko_bindingHandlers_dataTable_Instance";

ko.bindingHandlers["dataTable"] = {
    addOnInitListener: (handler: (eventObject: JQueryEventObject) => any) => {
        /// <Summary>
        /// Registers a event handler that fires when the Data Table is being initialised.
        /// </Summary>
        $(document).bind(onInitialisingEventName, <any>handler);
    },
    removeOnInitListener: (handler: (eventObject: JQueryEventObject) => any) => {
        /// <Summary>
        /// Unregisters an event handler to the onInitialising event.
        /// </Summary>
        $(document).unbind(onInitialisingEventName, <any>handler);
    },
    init: (element: HTMLElement, valueAccessor: () => any, allBindings: () => any, viewModel: any, bindingContext: KnockoutBindingContext) => {
        var binding: any = ko.unwrap(valueAccessor());
        var options = $.extend(true, {}, valueAccessor().options);
        var searchObservable = allBindings().dtfilter;
        
        // If the table has already been initialised, exit now.  Sometimes knockout.js invokes the init function of a binding handler in particular
        // situations twice for a given element.
        if (getDataTableInstance(element)) {
            return null;
        }

        // ** Initialise the DataTables options object with the data-bind settings **

        // Clone the options object found in the data bindings.  This object will form the base for the DataTable initialisation object.
        if (null != binding.dtoptions) {
            options = ko.utils.extend(options, binding.dtoptions);
        }

        // Define the tables columns.
        if (binding.columns && binding.columns.length) {
            options.aoColumns = [];
            ko.utils.arrayForEach(binding.columns,(col) => {

                if (typeof col == "string") {
                    col = { mDataProp: col }
                }

                options.aoColumns.push(col);
            });
        }

        // Support for computed template name and templates that change
        var rowTemplate = ko.utils.unwrapObservable(binding.rowTemplate);
        if (ko.isObservable(binding.rowTemplate)) {
            binding.rowTemplate.subscribe((value: any) => {
                rowTemplate = value;
                getDataTableInstance(element).fnDraw();
            });
        }

        // Register the row template to be used with the DataTable.
        if (binding.rowTemplate && binding.rowTemplate !== '') {   
            // Intercept the fnRowCallback function.
            options.fnRowCallback = cog.utils.intercept(options.fnRowCallback || ((row: any) => { return row; }),(row: any, data: any, displayIndex: number, displayIndexFull: number, next: any) => {
                // Render the row template for this row.
                var rowContext = bindingContext.createChildContext(data);
                
                if (binding.rowBindings) {
                    ko.cleanNode(row);
                    $(row).attr("data-bind", binding.rowBindings);
                    ko.applyBindingsToNode(row, rowContext);
                    ko.applyBindingAccessorsToNode(row, null, rowContext);
                }

                ko.renderTemplate(rowTemplate, rowContext, null, row, "replaceChildren");
               
                return next(row, data, displayIndex, displayIndexFull);
            });
        }

        // Set the data source of the DataTable.
        if (binding.dataSource) {
            var dataSource: any = ko.unwrap(binding.dataSource);

            // If the data source is a function that gets the data for us...
            if (typeof dataSource == 'function' && dataSource.length === 2) {
                // Register a fnServerData callback which calls the data source function when the DataTable requires data.
                options.fnServerData = (source: any, criteria: any, callback: (e: any) => void) => {
                    dataSource.call(viewModel, convertDataCriteria(criteria),(result: any) => {
                        callback({
                            aaData: ko.utils.unwrapObservable(result.Data),
                            iTotalRecords: ko.utils.unwrapObservable(result.TotalRecords),
                            iTotalDisplayRecords: ko.utils.unwrapObservable(result.DisplayedRecords)
                        });
                    });
                }

                // In this data source scenario, we are relying on the server processing.
                options.bProcessing = true;
                options.bServerSide = true;
            }
            // If the data source is a javascript array...
            else if (dataSource instanceof Array) {
                // Set the initial datasource of the table.
                options.aaData = ko.unwrap(binding.dataSource);

                // If the data source is a knockout observable array...
                if (ko.isObservable(binding.dataSource)) {
                    // Subscribe to the dataSource observable.  This callback will fire whenever items are added to 
                    // and removed from the data source.
                    binding.dataSource.subscribe((newItems: any[]) => {
                        console.warn('new datatable items', newItems);
                        //Clear
                        //$(element).dataTable().fnClearTable();
                        // ** Redraw table **
                        var dataTable: any = $(element).dataTable();
                        setDataTableInstanceOnBinding(dataTable, binding.table);

                        // If the table contains data...
                        if (dataTable.fnGetData().length) {
                            // Clear the datatable of rows, and if there are no items to display
                            // in newItems, force the fnClearTables call to rerender the table (because
                            // the call to fnAddData with a newItems.length == 0 wont rerender the table).
                            dataTable.fnClearTable(newItems.length === 0);
                        }

                        // Unwrap the items in the data source if required.
                        var unwrappedItems: any[] = [];
                        ko.utils.arrayForEach(newItems,(item: any) => {
                            unwrappedItems.push(ko.utils.unwrapObservable(item));
                        });

                        // Add the new data back into the data table.
                        dataTable.fnAddData(unwrappedItems);

                        // Get a list of rows in the DataTable.
                        var tableRows = dataTable.fnGetNodes();

                        // Unregister each of the table rows from knockout.
                        // NB: This must be called after fnAddData and fnClearTable are called because we want to allow
                        // DataTables to fire it's draw callbacks with the table's rows in their original state.  Calling
                        // this any earlier will modify the tables rows, which may cause issues with third party plugins that 
                        // use the data table.
                        ko.utils.arrayForEach(tableRows,(tableRow: any) => { ko.cleanNode(tableRow); });

                        //when using rowTemplate, must force re-draw to set correct bindings
                        dataTable.api().draw();
                    });
                }
            }
            // If the dataSource was not a function that retrieves data, or a javascript object array containing data.
            else {
                throw 'The dataSource defined must either be a javascript object array, or a function that takes special parameters.';
            }
        }

        // If no fnRowCallback has been registered in the DataTable's options, then register the default fnRowCallback.
        // This default fnRowCallback function is called for every row in the data source.  The intention of this callback
        // is to build a table row that is bound it's associated record in the data source via knockout js.
        if (!binding.rowTemplate || binding.rowTemplate === '') {
            options.fnRowCallback = cog.utils.intercept(options.fnRowCallback || ((row: any) => { return row; }), function (row: any, srcData: any, displayIndex: any, displayIndexFull: any, next: any) {
                var columns = this.fnSettings().aoColumns;

                // Empty the row that has been build by the DataTable of any child elements.
                var destRow = $(row);
                destRow.empty();

                // For each column in the data table...
                ko.utils.arrayForEach(columns,(column: any) => {
                    var columnName = column.mDataProp;
                    // Create a new cell.
                    var newCell = $("<td></td>");
                    // Insert the cell in the current row.
                    destRow.append(newCell);
                    // bind the cell to the observable in the current data row.
                    var accesor: string = eval("srcData['" + columnName.replace(".", "']['") + "']");
                    var koCray : any = ko;
                    koCray.applyBindingsToNode(newCell[0], { text: accesor }, bindingContext.createChildContext(srcData));
                });

                return next(destRow[0], srcData, displayIndex, displayIndexFull);
            });
        }

        // Before the table has it's rows rendered, we want to scan the table for elements with knockout bindings
        // and bind them to the current binding context.  This is so you can bind elements like the header row of the
        // table to observables your view model.  Ideally, it would be great to call ko.applyBindingsToNode here,
        // but when we initialise the table with dataTables, it seems dataTables recreates the elements in the table
        // during it's initialisation proccess, killing any knockout bindings you apply before initialisation.  Instead,
        // we mark the elements to bind here with the ko-bind class so we can recognise the elements after the table has been initialised,
        // for binding.
        $(element).find("[data-bind]").each((i, childElement) => {
            $(childElement).addClass("ko-bind");
        });

        // Fire the onInitialising event to allow the options object to be globally edited before the dataTables table is initialised.  This
        // gives third party javascript the ability to apply any additional settings to the dataTable before load.
        $(document).trigger(onInitialisingEventName, { options: options });

        var dataTable = $(element).dataTable(options);
        setDataTableInstanceOnBinding(dataTable, binding.table);
        setDataTableInstance(element, dataTable);

        // Apply bindings to those elements that were marked for binding.  See comments above.
        $(element).find(".ko-bind").each((e, childElement) => {
            var koCray: any = ko;
            koCray.applyBindingsToNode(childElement, null, bindingContext);
            $(childElement).removeClass("ko-bind");
        });

        if (ko.isObservable(searchObservable)) {
            searchObservable.subscribe((newValue: any) => {
                dataTable.fnFilter(newValue);
            });
        }

        // Tell knockout that the control rendered by this binding is capable of managing the binding of it's descendent elements.
        // This is crucial, otherwise knockout will attempt to rebind elements that have been printed by the row template.
        return { controlsDescendantBindings: true };

    },
    getDataTableInstance: (element: HTMLElement) => {
        return getDataTableInstance(<any>element);
    }
};

function convertDataCriteria(srcOptions: any) {
    var getColIndex = (name: string) => {
        var matches = name.match("\\d+");

        if (matches && matches.length) {
            return matches[0];
        }

        return null;
    }

    var destOptions: any = { Columns: [] };

    // Figure out how many columns in in the data table.
    for (var i = 0; i < srcOptions.length; i++) {
        if (srcOptions[i].name === "iColumns") {
            for (var j = 0; j < srcOptions[i].value; j++) {
                destOptions.Columns.push(new Object());
            }

            break;
        }
    }

    ko.utils.arrayForEach(srcOptions,(item: any) => {
        var colIndex = getColIndex(item.name);

        if (item.name === "iDisplayStart") {
            destOptions.RecordsToSkip = item.value;
        } else if (item.name === "iDisplayLength") {
            destOptions.RecordsToTake = item.value;
        } else if (item.name === "sSearch") {
            destOptions.GlobalSearchText = item.value;
        } else if (cog.utils.string.startsWith(item.name, "bSearchable_")) {
            destOptions.Columns[colIndex].IsSearchable = item.value;
        } else if (cog.utils.string.startsWith(item.name, "sSearch_")) {
            destOptions.Columns[colIndex].SearchText = item.value;
        } else if (cog.utils.string.startsWith(item.name, "mDataProp_")) {
            destOptions.Columns[colIndex].ColumnName = item.value;
        } else if (cog.utils.string.startsWith(item.name, "iSortCol_")) {
            destOptions.Columns[item.value].IsSorted = true;
            destOptions.Columns[item.value].SortOrder = colIndex;

            var sortOrder = ko.utils.arrayFilter(srcOptions,(item: any) => {
                return item.name === "sSortDir_" + colIndex;
            });

            if (sortOrder.length && (<any>(sortOrder[0])).value === "desc") {
                destOptions.Columns[item.value].SortDirection = "Descending";
            }
            else {
                destOptions.Columns[item.value].SortDirection = "Ascending";
            }
        }
    });

    return destOptions;
}

function getDataTableInstance(element: HTMLElement) {
    return $(element).data(dataTablesInstanceDataKey);
}

function setDataTableInstance(element: HTMLElement, dataTable: DataTables.DataTable) {
    $(element).data(dataTablesInstanceDataKey, dataTable);
}

function setDataTableInstanceOnBinding(dataTable: any, binding: any) {
    if (binding && ko.isObservable(binding)) {
        binding(dataTable);
    }
}

var cog: any = new function () {
    this.string = new function () {
        this.format = (...params: any[]): string => {
            var s = params[0];
            for (var i = 0; i < params.length - 1; i++) {
                var reg = new RegExp("\\{" + i + "\\}", "gm");
                s = s.replace(reg, params[i + 1]);
            }

            return s;
        };

        this.endsWith = (string: string, suffix: string) => {
            return (string.substr(string.length - suffix.length) === suffix);
        };

        this.startsWith = (string: string, prefix: string) => {
            return (string.substr(0, prefix.length) === prefix);
        };

        this.trimEnd = function (string: string, chars: string) {
            if (this.endsWith(string, chars)) {
                return string.substring(0, string.length - chars.length);
            }

            return string;
        };

        this.trimStart = function (string: string, chars: string) {
            if (this.startsWith(string, chars)) {
                return string.substring(chars.length, string.length);
            }

            return string;
        };
    };
    this.utils = new function () {
        this.intercept = (fnToIntercept: (e: any) => void, fnToExecute: any) => {
            /// <summary>
            /// Intercepts a function with another function.  The original function is passed to the new function
            /// as the last argument of it's parameter list, and must be executed within the new function for the interception
            /// to be complete.
            /// </summary>
            /// <param name="fnToIntercept" type="Function">
            ///     The old function to intercept.
            /// </param>
            /// <param name="fnToExecute" type="Function">
            ///     The new function to be executed.
            /// </param>
            /// <returns>
            ///     A proxy function that performs the interception.  Execute this function like you would execute the fnToExecute function.
            /// </returns>
            fnToIntercept = fnToIntercept || (() => { });
            return function () {
                var newArguments: any[] = [];
                $.each(arguments,(i, item) => { newArguments.push(item); });
                newArguments.push(fnToIntercept);
                return fnToExecute.apply(this, newArguments);
            }
        }
    }
};
