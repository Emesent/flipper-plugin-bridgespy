import React from "react";
import {
  Button,
  colors,
  DetailSidebar,
  FlipperPlugin,
  ManagedDataInspector,
  Panel,
  FlexCenter,
  SearchableTable,
  styled,
  TableHighlightedRows,
  FlexColumn,
  Filter
} from "flipper";

import * as Sentry from "@sentry/react";
import { Integrations } from "@sentry/tracing";
import * as fs from "fs";
import { stringify } from "csv-stringify";


Sentry.init({
  dsn: "https://d5f779a2974943bdb3c0aa09cbfcbc2e@o483753.ingest.sentry.io/5577125",
  autoSessionTracking: true,
  integrations: [
    new Integrations.BrowserTracing(),
  ],

  // We recommend adjusting this value in production, or using tracesSampler
  // for finer control
  tracesSampleRate: 0.5,
});


type Id = string;

type DataRow = {
  id: Id;
  time: number;
  type: string;
  module: string;
  method: string | number;
  args: string;
};

type MessageRow = {
  columns: {
    index: {
      value: string;
    };
    time: {
      value: string;
    };
    type: {
      value?: string;
      isFilterable: true;
    };
    module: {
      value: string;
      isFilterable: true;
    };
    method: {
      value?: string;
      isFilterable: true;
    };
    args: {
      value?: string;
      isFilterable: true;
    };
  };
  timestamp: number;
  payload?: any;
  key: string;
};

type State = {
  selectedId: string | null;
  filters: Array<Filter>;
  messagesPerSecond: number;
  bandwidthPerSecond: number;
};

type PersistedState = {
  messageRows: Array<MessageRow>;
};

const Placeholder = styled(FlexCenter)({
  fontSize: 18,
  color: colors.macOSTitleBarIcon,
});

const HeaderText = styled(FlexCenter)();

function buildRow(row: DataRow | DataRow[]): MessageRow[] {
  if (!(row instanceof Array)) row = [row];

  return row.map((r) => ({
    columns: {
      index: {
        value: r.id,
      },
      time: {
        value: new Date(r.time).toLocaleString(undefined, {
          fractionalSecondDigits: 3,
          hour12: false,
          year: "2-digit",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        }),
      },
      type: {
        value: r.type,
        isFilterable: true,
      },
      module: {
        value: r.module ?? "",
        isFilterable: true,
      },
      method: {
        value: r.method.toString(),
        isFilterable: true,
      },
      args: {
        value: JSON.stringify(r.args),
        isFilterable: true,
      },
    },
    key: r.id,
    payload: r,
    timestamp: r.time,
  }));
}

const columns = {
  index: {
    value: "Id",
  },
  time: {
    value: "Timestamp",
  },
  type: {
    value: "Direction",
  },
  module: {
    value: "Module",
  },
  method: {
    value: "Method",
  },
  args: {
    value: "Data",
  },
};

const columnSizes = {
  index: "5%",
  time: "10%",
  type: "5%",
  module: "10%",
  method: "10%",
  args: "flex",
};

const filename = "bridge_spy_logs.csv";
const writableStream = fs.createWriteStream(filename);
console.log(`Bridge Spy logs saved to Flipper exec root directory as "${ filename }"`);
const stringifier = stringify({ header: true, columns: Object.values(columns).map(col => col.value) });

export default class extends FlipperPlugin<State, any, PersistedState> {
  static defaultPersistedState = {
    messageRows: [],
  };

  state: State = {
    selectedId: null,
    filters: [],
    messagesPerSecond: 0,
    bandwidthPerSecond: 0
  };

  interval: NodeJS.Timeout | undefined;

  static persistedStateReducer = (persistedState: PersistedState, method: string, payload: any): PersistedState => {
    if (method === "newRow") {
      const newRows = buildRow(payload);
      
      /**
       * Disabled as duplicate entries are being written to the CSV, causing very large (GBs) files.
       * This isn't the result of the `persistedStateReducer` or duplicate rows in code. 
       * There's something wrong with the usage of `stringifier.write` or .pipe. 
       *  */ 
      /*
      for(const row of newRows){
        stringifier.write(Object.values(row.columns).map(col => col.value));
      }
      stringifier.pipe(writableStream);
      */
  
      return {
        ...persistedState,
        messageRows: [...persistedState.messageRows, ...newRows].filter(
          (row) => Date.now() - row.timestamp < 5 * 60 * 1000,
        ),
      };
    }
    return persistedState;
  };

  getMessagesPerSecond = () => {
    const filteredSecondMessages = this.filterMessages().length;
    return Math.ceil(filteredSecondMessages / 5);
  }

  getBandwidthPerSecond = () => {
    const filteredSecondMessages = this.filterMessages();
    return this.getSizeInBytes(filteredSecondMessages) / 5;
  }

  filterMessages = () => {
    const filteredSecondMessages = this.props.persistedState.messageRows.filter(
      (row) => {
        if (Date.now() - row.timestamp > 5 * 1000) {  
          return false;
        }

        if (this.state.filters.length === 0) {
          return true;
        }

        for(const filter of this.state.filters){
          return row.columns[filter.key as keyof typeof columns].value === filter.value
        }
      }
    );

    return filteredSecondMessages;
  }

  componentDidMount() {
    this.interval = setInterval(() => {
      const messagesPerSecond = this.getMessagesPerSecond();
      const bandwidthPerSecond = this.getBandwidthPerSecond();

      this.setState({
        messagesPerSecond: messagesPerSecond,
        bandwidthPerSecond: bandwidthPerSecond
      })
    }, 5000);
  }

  componentWillUnmount() {
    // Clear the interval right before component unmount
    if (this.interval) {
      clearInterval(this.interval);
    }
  }

  render() {
    const clearTableButton = (
      <Button onClick={this.clear} key="clear">
        Clear Table
      </Button>
    );

    const mshPerSecText = (
      <HeaderText>
        { `${ Math.ceil(this.state.messagesPerSecond / 5) } msg/s` }
      </HeaderText>
    );

    const bandwidthPerSecText = (
      <HeaderText>
        { this.formatBytes(this.state.bandwidthPerSecond) }
      </HeaderText>
    );

    return (
      <FlexColumn grow>
        <SearchableTable
          rowLineHeight={28}
          floating={false}
          multiline
          allowRegexSearch
          columnSizes={columnSizes}
          columns={columns}
          onRowHighlighted={this.onRowHighlighted}
          onFilterChange={this.onFilterChange}
          rows={this.props.persistedState.messageRows}
          stickyBottom
          actions={[mshPerSecText, bandwidthPerSecText, clearTableButton]}
        />
        <DetailSidebar>{this.renderSidebar()}</DetailSidebar>
      </FlexColumn>
    );
  }

  onFilterChange = (filters: Array<Filter>) => {
    this.setState({
      messagesPerSecond: 0,
      bandwidthPerSecond: 0,
      filters
    })
  }

  onRowHighlighted = (keys: TableHighlightedRows) => {
    if (keys.length > 0) {
      this.setState({
        selectedId: keys[0],
      });
    }
  };

  renderSidebar() {
    const { selectedId } = this.state;
    const { messageRows } = this.props.persistedState;
    if (selectedId !== null) {
      const message = messageRows.find((row) => row.key == selectedId);
      if (message != null) {
        return this.renderExtra(message.payload);
      }
    }
    return <Placeholder grow>Select a message to view details</Placeholder>;
  }

  renderExtra(extra: any) {
    return (
      <Panel floating={false} grow={false} heading={"Payload"}>
        <ManagedDataInspector data={extra} expandRoot={false} />
      </Panel>
    );
  }

  clear = () => {
    this.setState({ selectedId: null });
    this.props.setPersistedState({ messageRows: [] });
  };

  getSizeInBytes = (obj: object): number => {
    let str = null;
    if (typeof obj === 'string') {
      str = obj;
    } else {
      str = JSON.stringify(obj);
    }
    const bytes = new TextEncoder().encode(str).length;
    return bytes;
  };

  formatBytes(bytes: number, fractionDigits: number = 2): string {
    if (bytes <= 0) {
      return "0 B/s";
    }
    fractionDigits = fractionDigits < 0 ? 0 : fractionDigits;
    const k = 1000;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(fractionDigits))} ${sizes[i]}/s`;
  }
}
